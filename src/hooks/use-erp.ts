// Cascada — ERP React Query Hooks
// Data-fetching and mutation hooks for ERP connection and sync API endpoints.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api-client";
import type { ErpConnectionStatus } from "@/types/api";
import type { ErpHealthStatus, SyncResult, MultiEntitySyncResult, ErpConnectionTestResult } from "@/types/erp";
import type { ErpType, SyncStatus } from "@prisma/client";

// ============================================================================
// API response shapes
// ============================================================================

interface ErpConnectionDetail {
  id: string;
  erpType: ErpType;
  connectionName: string;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  fieldMappings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ErpSyncResponse {
  connectionId: string;
  syncType: "full" | "incremental";
  results: MultiEntitySyncResult;
  status: SyncStatus;
}

interface ErpHealthResponse {
  connectionId: string;
  health: ErpHealthStatus;
}

// ============================================================================
// Query key factory
// ============================================================================

export const erpKeys = {
  all: ["erp"] as const,
  connections: () => [...erpKeys.all, "connections"] as const,
  connectionDetail: (id: string) =>
    [...erpKeys.all, "connections", id] as const,
} as const;

// ============================================================================
// useErpConnections
// ============================================================================

export function useErpConnections() {
  return useQuery<ErpConnectionStatus[], ApiClientError>({
    queryKey: erpKeys.connections(),
    queryFn: () =>
      apiClient.get<ErpConnectionStatus[]>("/api/erp-connections"),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ============================================================================
// useErpConnectionDetail
// ============================================================================

export function useErpConnectionDetail(id: string) {
  return useQuery<ErpConnectionDetail, ApiClientError>({
    queryKey: erpKeys.connectionDetail(id),
    queryFn: () =>
      apiClient.get<ErpConnectionDetail>(`/api/erp-connections/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ============================================================================
// useErpSync — mutation
// ============================================================================

export function useErpSync(id: string) {
  const queryClient = useQueryClient();

  return useMutation<ErpSyncResponse, ApiClientError, { syncType?: "full" | "incremental" }>({
    mutationFn: (variables) =>
      apiClient.post<ErpSyncResponse, { syncType?: "full" | "incremental" }>(
        `/api/erp-connections/${id}/sync`,
        variables
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: erpKeys.connectionDetail(id) });
      void queryClient.invalidateQueries({ queryKey: erpKeys.connections() });
    },
  });
}

// ============================================================================
// useErpHealth — mutation (triggers a health check)
// ============================================================================

export function useErpHealth(id: string) {
  const queryClient = useQueryClient();

  return useMutation<ErpHealthResponse, ApiClientError, void>({
    mutationFn: () =>
      apiClient.post<ErpHealthResponse, void>(
        `/api/erp-connections/${id}/health`
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: erpKeys.connectionDetail(id) });
      void queryClient.invalidateQueries({ queryKey: erpKeys.connections() });
    },
  });
}
