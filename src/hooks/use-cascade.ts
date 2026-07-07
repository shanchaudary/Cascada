// Cascada — Cascade React Query Hooks
// Data-fetching and mutation hooks for the cascade engine API endpoints.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { normalizeCascadeTriggers } from "@/lib/dashboard-normalizers";
import type {
  CascadeGraphStats,
  CascadeTriggerSummary,
  CascadeExposureSummary,
} from "@/types/api";
import type {
  TraversalResult,
  CompositeImpactScore,
  CascadeCostSummary,
} from "@/types/cascade";
import type { Severity, TriggerStatus } from "@prisma/client";

// ============================================================================
// Cascade graph node/edge shape returned by the API
// ============================================================================

interface CascadeGraphData {
  nodes: Array<{
    id: string;
    nodeType: string;
    entityId: string;
    label: string;
    riskScore: number | null;
    properties: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: string;
    strength: number | null;
    properties: Record<string, unknown>;
  }>;
  graphId: string;
  version: number;
}

interface CascadeTriggerDetail {
  id: string;
  title: string;
  severity: Severity;
  status: TriggerStatus;
  triggerType: string;
  description: string;
  affectedNodeIds: string[];
  cascadeDepth: number;
  cascadeBreadth: number;
  totalSkusAffected: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  deadlineDate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AnalyzeTriggerResponse {
  triggerId: string;
  traversal: TraversalResult;
  impactScore: CompositeImpactScore;
  costSummary: CascadeCostSummary;
  status: TriggerStatus;
}

interface CascadeImpactItem {
  id: string;
  triggerId: string;
  nodeId: string;
  impactType: string;
  description: string;
  financialImpact: number | null;
  timelineImpact: number | null;
  reformRequired: boolean;
  reformCost: number | null;
  priority: number | null;
}

// ============================================================================
// Query key factory
// ============================================================================

export const cascadeKeys = {
  all: ["cascade"] as const,
  graph: () => [...cascadeKeys.all, "graph"] as const,
  graphStats: () => [...cascadeKeys.all, "graph", "stats"] as const,
  triggers: (status?: TriggerStatus, severity?: Severity) =>
    [...cascadeKeys.all, "triggers", status, severity] as const,
  triggerDetail: (id: string) =>
    [...cascadeKeys.all, "triggers", id] as const,
  triggerImpacts: (triggerId: string) =>
    [...cascadeKeys.all, "triggers", triggerId, "impacts"] as const,
  exposure: () => [...cascadeKeys.all, "exposure"] as const,
} as const;

// ============================================================================
// useCascadeGraph
// ============================================================================

export function useCascadeGraph() {
  return useQuery<CascadeGraphData, ApiClientError>({
    queryKey: cascadeKeys.graph(),
    queryFn: () => apiClient.get<CascadeGraphData>("/api/cascade/graph"),
    staleTime: 120_000,
  });
}

// ============================================================================
// useCascadeStats
// ============================================================================

export function useCascadeStats() {
  return useQuery<CascadeGraphStats, ApiClientError>({
    queryKey: cascadeKeys.graphStats(),
    queryFn: () => apiClient.get<CascadeGraphStats>("/api/cascade/graph/stats"),
    staleTime: 120_000,
  });
}

// ============================================================================
// useCascadeTriggers
// ============================================================================

export function useCascadeTriggers(status?: TriggerStatus, severity?: Severity) {
  return useQuery<CascadeTriggerSummary[], ApiClientError>({
    queryKey: cascadeKeys.triggers(status, severity),
    queryFn: () =>
      apiClient
        .get<unknown>("/api/cascade/triggers", {
          status,
          severity,
        })
        .then(normalizeCascadeTriggers),
    staleTime: 30_000,
  });
}

// ============================================================================
// useCascadeTriggerDetail
// ============================================================================

export function useCascadeTriggerDetail(id: string) {
  return useQuery<CascadeTriggerDetail, ApiClientError>({
    queryKey: cascadeKeys.triggerDetail(id),
    queryFn: () =>
      apiClient.get<CascadeTriggerDetail>(`/api/cascade/triggers/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ============================================================================
// useAnalyzeTrigger — mutation
// ============================================================================

export function useAnalyzeTrigger(id: string) {
  const queryClient = useQueryClient();

  return useMutation<AnalyzeTriggerResponse, ApiClientError, void>({
    mutationFn: () =>
      apiClient.post<AnalyzeTriggerResponse, void>(
        `/api/cascade/triggers/${id}/analyze`
      ),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: cascadeKeys.triggerDetail(id) });
      void queryClient.invalidateQueries({ queryKey: cascadeKeys.triggers() });
      void queryClient.invalidateQueries({ queryKey: cascadeKeys.triggerImpacts(id) });
      void queryClient.setQueryData(cascadeKeys.triggerDetail(id), data);
    },
  });
}

// ============================================================================
// useCascadeImpacts
// ============================================================================

export function useCascadeImpacts(triggerId: string) {
  return useQuery<CascadeImpactItem[], ApiClientError>({
    queryKey: cascadeKeys.triggerImpacts(triggerId),
    queryFn: () =>
      apiClient.get<CascadeImpactItem[]>(
        `/api/cascade/triggers/${triggerId}/impacts`
      ),
    enabled: Boolean(triggerId),
    staleTime: 60_000,
  });
}

// ============================================================================
// useCascadeExposure
// ============================================================================

export function useCascadeExposure() {
  return useQuery<CascadeExposureSummary, ApiClientError>({
    queryKey: cascadeKeys.exposure(),
    queryFn: () => apiClient.get<CascadeExposureSummary>("/api/cascade/exposure"),
    staleTime: 60_000,
  });
}
