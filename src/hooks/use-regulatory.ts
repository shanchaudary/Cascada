// Cascada — Regulatory React Query Hooks
// Data-fetching and mutation hooks for the regulatory source and rule API endpoints.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api-client";
import type { PaginatedResponse } from "@/types/api";
import type { ParsedRule, SubstanceMatchResult } from "@/types/regulatory";
import type { SourceStatus, SourceType, RuleType } from "@prisma/client";

// ============================================================================
// API response shapes
// ============================================================================

interface RegulatorySourceItem {
  id: string;
  sourceType: SourceType;
  jurisdiction: string;
  name: string;
  sourceId: string | null;
  sourceUrl: string | null;
  status: SourceStatus;
  introducedDate: string | null;
  enactedDate: string | null;
  effectiveDate: string | null;
  processedAt: string | null;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RegulatorySourceDetail extends RegulatorySourceItem {
  fullText: string | null;
  rawApiResponse: Record<string, unknown> | null;
  rules: RegulatoryRuleItem[];
}

interface RegulatoryRuleItem {
  id: string;
  sourceId: string;
  version: number;
  jurisdiction: string;
  ruleType: RuleType;
  description: string;
  effectiveDate: string | null;
  complianceDate: string | null;
  gracePeriodDays: number | null;
  penaltyType: string | null;
  penaltyAmount: number | null;
  notes: string | null;
  smeValidatedBy: string | null;
  smeValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RegulatoryRuleDetail extends RegulatoryRuleItem {
  exemptions: Record<string, unknown> | null;
  substances: Array<{
    id: string;
    substanceName: string;
    substanceType: string;
    casNumber: string | null;
    eenumber: string | null;
    threshold: number | null;
    thresholdUnit: string | null;
    productScope: Record<string, unknown> | null;
    isMatched: boolean;
    matchConfidence: number | null;
    matchMethod: string | null;
    ingredientId: string | null;
  }>;
}

interface ProcessSourceResponse {
  sourceId: string;
  status: SourceStatus;
  rules: ParsedRule[];
  substanceMatchResult: SubstanceMatchResult;
}

interface ValidateSourceResponse {
  sourceId: string;
  status: SourceStatus;
  validatedBy: string;
  validatedAt: string;
}

interface RegulatorySearchResult {
  sources: RegulatorySourceItem[];
  rules: RegulatoryRuleItem[];
  totalResults: number;
  query: string;
}

// ============================================================================
// Query key factory
// ============================================================================

export const regulatoryKeys = {
  all: ["regulatory"] as const,
  sources: (status?: SourceStatus, sourceType?: SourceType, page?: number, limit?: number) =>
    [...regulatoryKeys.all, "sources", status, sourceType, page, limit] as const,
  sourceDetail: (id: string) =>
    [...regulatoryKeys.all, "sources", id] as const,
  rules: (jurisdiction?: string, ruleType?: RuleType, page?: number, limit?: number) =>
    [...regulatoryKeys.all, "rules", jurisdiction, ruleType, page, limit] as const,
  ruleDetail: (id: string) =>
    [...regulatoryKeys.all, "rules", id] as const,
  search: (query: string) =>
    [...regulatoryKeys.all, "search", query] as const,
} as const;

// ============================================================================
// useRegulatorySources
// ============================================================================

export function useRegulatorySources(
  status?: SourceStatus,
  sourceType?: SourceType,
  page?: number,
  limit?: number
) {
  return useQuery<PaginatedResponse<RegulatorySourceItem>, ApiClientError>({
    queryKey: regulatoryKeys.sources(status, sourceType, page, limit),
    queryFn: () =>
      apiClient.get<PaginatedResponse<RegulatorySourceItem>>(
        "/api/regulatory/sources",
        { status, sourceType, page, limit }
      ),
    staleTime: 60_000,
  });
}

// ============================================================================
// useRegulatorySourceDetail
// ============================================================================

export function useRegulatorySourceDetail(id: string) {
  return useQuery<RegulatorySourceDetail, ApiClientError>({
    queryKey: regulatoryKeys.sourceDetail(id),
    queryFn: () =>
      apiClient.get<RegulatorySourceDetail>(`/api/regulatory/sources/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ============================================================================
// useProcessSource — mutation
// ============================================================================

export function useProcessSource(id: string) {
  const queryClient = useQueryClient();

  return useMutation<ProcessSourceResponse, ApiClientError, void>({
    mutationFn: () =>
      apiClient.post<ProcessSourceResponse, void>(
        `/api/regulatory/sources/${id}/process`
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: regulatoryKeys.sourceDetail(id) });
      void queryClient.invalidateQueries({ queryKey: regulatoryKeys.sources() });
      void queryClient.invalidateQueries({ queryKey: regulatoryKeys.rules() });
    },
  });
}

// ============================================================================
// useValidateSource — mutation
// ============================================================================

export function useValidateSource(id: string) {
  const queryClient = useQueryClient();

  return useMutation<ValidateSourceResponse, ApiClientError, void>({
    mutationFn: () =>
      apiClient.post<ValidateSourceResponse, void>(
        `/api/regulatory/sources/${id}/validate`
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: regulatoryKeys.sourceDetail(id) });
      void queryClient.invalidateQueries({ queryKey: regulatoryKeys.sources() });
    },
  });
}

// ============================================================================
// useRegulatoryRules
// ============================================================================

export function useRegulatoryRules(
  jurisdiction?: string,
  ruleType?: RuleType,
  page?: number,
  limit?: number
) {
  return useQuery<PaginatedResponse<RegulatoryRuleItem>, ApiClientError>({
    queryKey: regulatoryKeys.rules(jurisdiction, ruleType, page, limit),
    queryFn: () =>
      apiClient.get<PaginatedResponse<RegulatoryRuleItem>>(
        "/api/regulatory/rules",
        { jurisdiction, ruleType, page, limit }
      ),
    staleTime: 60_000,
  });
}

// ============================================================================
// useRegulatoryRuleDetail
// ============================================================================

export function useRegulatoryRuleDetail(id: string) {
  return useQuery<RegulatoryRuleDetail, ApiClientError>({
    queryKey: regulatoryKeys.ruleDetail(id),
    queryFn: () =>
      apiClient.get<RegulatoryRuleDetail>(`/api/regulatory/rules/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ============================================================================
// useRegulatorySearch
// ============================================================================

export function useRegulatorySearch(query: string) {
  return useQuery<RegulatorySearchResult, ApiClientError>({
    queryKey: regulatoryKeys.search(query),
    queryFn: () =>
      apiClient.get<RegulatorySearchResult>("/api/regulatory/search", { query }),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });
}
