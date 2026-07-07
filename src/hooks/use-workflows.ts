// Cascada — Workflow React Query Hooks
// Data-fetching and mutation hooks for workflow instance API endpoints.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { normalizeArray, normalizePaginatedResponse } from "@/lib/dashboard-normalizers";
import type { PaginatedResponse } from "@/types/api";
import type { WorkflowStatus } from "@prisma/client";

// ============================================================================
// API response shapes
// ============================================================================

interface WorkflowInstanceItem {
  id: string;
  workflowType: string;
  status: WorkflowStatus;
  currentStep: string | null;
  assignedTo: string[];
  startedAt: string | null;
  completedAt: string | null;
  errorDetail: string | null;
  createdAt: string;
  updatedAt: string;
}

interface WorkflowInstanceDetail extends WorkflowInstanceItem {
  decisionPackageId: string | null;
  temporalWorkflowId: string | null;
  steps: Array<{
    name: string;
    type: string;
    status: string;
    assignedTo: string[];
    startedAt: string | null;
    completedAt: string | null;
    output: Record<string, unknown> | null;
    error: string | null;
  }>;
}

interface WorkflowStepDetail {
  name: string;
  type: string;
  status: string;
  assignedTo: string[];
  startedAt: string | null;
  completedAt: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  dependencies: string[];
}

interface ApproveWorkflowResponse {
  workflowId: string;
  status: WorkflowStatus;
  currentStep: string | null;
  approvedBy: string;
  approvedAt: string;
}

interface RejectWorkflowResponse {
  workflowId: string;
  status: WorkflowStatus;
  rejectedBy: string;
  rejectedAt: string;
  reason: string | null;
}

// ============================================================================
// Query key factory
// ============================================================================

export const workflowKeys = {
  all: ["workflows"] as const,
  list: (status?: WorkflowStatus, workflowType?: string) =>
    [...workflowKeys.all, status, workflowType] as const,
  detail: (id: string) =>
    [...workflowKeys.all, id] as const,
  steps: (id: string) =>
    [...workflowKeys.all, id, "steps"] as const,
} as const;

// ============================================================================
// useWorkflows
// ============================================================================

export function useWorkflows(status?: WorkflowStatus, workflowType?: string) {
  return useQuery<PaginatedResponse<WorkflowInstanceItem>, ApiClientError>({
    queryKey: workflowKeys.list(status, workflowType),
    queryFn: () =>
      apiClient
        .get<unknown>("/api/workflows", { status, workflowType })
        .then((response) =>
          normalizePaginatedResponse<WorkflowInstanceItem>(response, ["items", "workflows", "data"])
        ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================================
// useWorkflowDetail
// ============================================================================

export function useWorkflowDetail(id: string) {
  return useQuery<WorkflowInstanceDetail, ApiClientError>({
    queryKey: workflowKeys.detail(id),
    queryFn: () =>
      apiClient.get<WorkflowInstanceDetail>(`/api/workflows/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ============================================================================
// useApproveWorkflow — mutation
// ============================================================================

export function useApproveWorkflow(id: string) {
  const queryClient = useQueryClient();

  return useMutation<ApproveWorkflowResponse, ApiClientError, { notes?: string }>({
    mutationFn: (payload) =>
      apiClient.post<ApproveWorkflowResponse, { notes?: string }>(
        `/api/workflows/${id}/approve`,
        payload
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workflowKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: workflowKeys.list() });
      void queryClient.invalidateQueries({ queryKey: workflowKeys.steps(id) });
    },
  });
}

// ============================================================================
// useRejectWorkflow — mutation
// ============================================================================

export function useRejectWorkflow(id: string) {
  const queryClient = useQueryClient();

  return useMutation<RejectWorkflowResponse, ApiClientError, { reason?: string }>({
    mutationFn: (payload) =>
      apiClient.post<RejectWorkflowResponse, { reason?: string }>(
        `/api/workflows/${id}/reject`,
        payload
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workflowKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: workflowKeys.list() });
      void queryClient.invalidateQueries({ queryKey: workflowKeys.steps(id) });
    },
  });
}

// ============================================================================
// useWorkflowSteps
// ============================================================================

export function useWorkflowSteps(id: string) {
  return useQuery<WorkflowStepDetail[], ApiClientError>({
    queryKey: workflowKeys.steps(id),
    queryFn: () =>
      apiClient
        .get<unknown>(`/api/workflows/${id}/steps`)
        .then((response) => normalizeArray<WorkflowStepDetail>(response, ["steps", "items", "data"])),
    enabled: Boolean(id),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
