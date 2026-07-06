// Cascada — Decision React Query Hooks
// Data-fetching and mutation hooks for decision package API endpoints.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api-client";
import type { DecisionPackageSummary, PaginatedResponse } from "@/types/api";
import type { Severity, TriggerStatus } from "@prisma/client";

// ============================================================================
// API response shapes
// ============================================================================

interface DecisionDetail {
  id: string;
  title: string;
  summary: string;
  mandateSummary: string;
  affectedSkuList: Array<{
    sku: string;
    productName: string;
    impact: string;
    cost: number | null;
  }>;
  complianceTimeline: Array<{
    date: string;
    event: string;
    jurisdiction: string;
    conflict: boolean;
  }>;
  reformulationOptions: Array<{
    ingredientName: string;
    substituteName: string;
    costDelta: number;
    feasibility: number;
    timelineDays: number;
  }>;
  prioritization: Array<{
    triggerId: string;
    title: string;
    riskScore: number;
    impactScore: number;
    urgencyScore: number;
    compositeScore: number;
    rank: number;
  }>;
  recommendation: string;
  generatedAt: string;
  deliveredAt: string | null;
  deliveryMethod: string | null;
  decision: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
}

interface DecideRequest {
  decision: "accept" | "reject" | "defer" | "partial";
  notes?: string;
}

interface DecideResponse {
  id: string;
  decision: string;
  decidedBy: string;
  decidedAt: string;
  decisionNotes: string | null;
}

interface DecisionReportData {
  decisionId: string;
  title: string;
  generatedAt: string;
  reportHtml: string;
}

// ============================================================================
// Query key factory
// ============================================================================

export const decisionKeys = {
  all: ["decisions"] as const,
  list: (status?: TriggerStatus, severity?: Severity) =>
    [...decisionKeys.all, status, severity] as const,
  detail: (id: string) =>
    [...decisionKeys.all, id] as const,
  report: (id: string) =>
    [...decisionKeys.all, id, "report"] as const,
} as const;

// ============================================================================
// useDecisions
// ============================================================================

export function useDecisions(status?: TriggerStatus, severity?: Severity) {
  return useQuery<PaginatedResponse<DecisionPackageSummary>, ApiClientError>({
    queryKey: decisionKeys.list(status, severity),
    queryFn: () =>
      apiClient.get<PaginatedResponse<DecisionPackageSummary>>(
        "/api/decisions",
        { status, severity }
      ),
    staleTime: 60_000,
  });
}

// ============================================================================
// useDecisionDetail
// ============================================================================

export function useDecisionDetail(id: string) {
  return useQuery<DecisionDetail, ApiClientError>({
    queryKey: decisionKeys.detail(id),
    queryFn: () =>
      apiClient.get<DecisionDetail>(`/api/decisions/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ============================================================================
// useDecide — mutation
// ============================================================================

export function useDecide(id: string) {
  const queryClient = useQueryClient();

  return useMutation<DecideResponse, ApiClientError, DecideRequest>({
    mutationFn: (payload) =>
      apiClient.post<DecideResponse, DecideRequest>(
        `/api/decisions/${id}/decide`,
        payload
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: decisionKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: decisionKeys.list() });
      void queryClient.invalidateQueries({ queryKey: decisionKeys.report(id) });
    },
  });
}

// ============================================================================
// useDecisionReport
// ============================================================================

export function useDecisionReport(id: string) {
  return useQuery<DecisionReportData, ApiClientError>({
    queryKey: decisionKeys.report(id),
    queryFn: () =>
      apiClient.get<DecisionReportData>(`/api/decisions/${id}/report`),
    enabled: Boolean(id),
    staleTime: 300_000,
  });
}
