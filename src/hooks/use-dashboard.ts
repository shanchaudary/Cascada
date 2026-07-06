// Cascada — Dashboard React Query Hooks
// Data-fetching hooks for the dashboard API endpoints.

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { ApiClientError } from "@/lib/api-client";
import type {
  DashboardSummary,
  ExposureByState,
  ProductWithExposure,
  UpcomingDeadline,
  CascadeTriggerSummary,
  PaginatedResponse,
} from "@/types/api";
import type { CascadeCostSummary } from "@/types/cascade";
import type { Severity } from "@prisma/client";

// ============================================================================
// Query key factory
// ============================================================================

export const dashboardKeys = {
  all: ["dashboard"] as const,
  summary: () => [...dashboardKeys.all, "summary"] as const,
  exposureByState: (minSeverity?: Severity) =>
    [...dashboardKeys.all, "exposure-by-state", minSeverity] as const,
  exposureByProduct: (category?: string, page?: number, limit?: number) =>
    [...dashboardKeys.all, "exposure-by-product", category, page, limit] as const,
  upcomingDeadlines: (daysAhead?: number) =>
    [...dashboardKeys.all, "upcoming-deadlines", daysAhead] as const,
  recentTriggers: (limit?: number, severity?: Severity) =>
    [...dashboardKeys.all, "recent-triggers", limit, severity] as const,
  costEstimates: () => [...dashboardKeys.all, "cost-estimates"] as const,
} as const;

// ============================================================================
// useDashboardSummary
// ============================================================================

export function useDashboardSummary() {
  return useQuery<DashboardSummary, ApiClientError>({
    queryKey: dashboardKeys.summary(),
    queryFn: () => apiClient.get<DashboardSummary>("/api/dashboard/summary"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ============================================================================
// useExposureByState
// ============================================================================

export function useExposureByState(minSeverity?: Severity) {
  return useQuery<ExposureByState[], ApiClientError>({
    queryKey: dashboardKeys.exposureByState(minSeverity),
    queryFn: () =>
      apiClient.get<ExposureByState[]>("/api/dashboard/exposure-by-state", {
        minSeverity,
      }),
    staleTime: 60_000,
  });
}

// ============================================================================
// useExposureByProduct
// ============================================================================

export function useExposureByProduct(category?: string, page?: number, limit?: number) {
  return useQuery<PaginatedResponse<ProductWithExposure>, ApiClientError>({
    queryKey: dashboardKeys.exposureByProduct(category, page, limit),
    queryFn: () =>
      apiClient.get<PaginatedResponse<ProductWithExposure>>(
        "/api/dashboard/exposure-by-product",
        { category, page, limit }
      ),
    staleTime: 60_000,
  });
}

// ============================================================================
// useUpcomingDeadlines
// ============================================================================

export function useUpcomingDeadlines(daysAhead?: number) {
  return useQuery<UpcomingDeadline[], ApiClientError>({
    queryKey: dashboardKeys.upcomingDeadlines(daysAhead),
    queryFn: () =>
      apiClient.get<UpcomingDeadline[]>("/api/dashboard/upcoming-deadlines", {
        daysAhead,
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================================
// useRecentTriggers
// ============================================================================

export function useRecentTriggers(limit?: number, severity?: Severity) {
  return useQuery<CascadeTriggerSummary[], ApiClientError>({
    queryKey: dashboardKeys.recentTriggers(limit, severity),
    queryFn: () =>
      apiClient.get<CascadeTriggerSummary[]>("/api/dashboard/recent-triggers", {
        limit,
        severity,
      }),
    staleTime: 30_000,
  });
}

// ============================================================================
// useCostEstimates
// ============================================================================

export function useCostEstimates() {
  return useQuery<CascadeCostSummary, ApiClientError>({
    queryKey: dashboardKeys.costEstimates(),
    queryFn: () => apiClient.get<CascadeCostSummary>("/api/dashboard/cost-estimates"),
    staleTime: 120_000,
  });
}
