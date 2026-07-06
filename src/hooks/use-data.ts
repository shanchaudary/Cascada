// Cascada — Data React Query Hooks
// Data-fetching hooks for ingredients, formulations, products, and exposure endpoints.

import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiClientError } from "@/lib/api-client";
import type { IngredientWithExposure, ProductWithExposure, PaginatedResponse } from "@/types/api";
import type { FormulationStatus } from "@prisma/client";

// ============================================================================
// API response shapes
// ============================================================================

interface IngredientDetail {
  id: string;
  name: string;
  alternateNames: string[];
  casNumber: string | null;
  eenumber: string | null;
  category: string | null;
  isSynthetic: boolean | null;
  sourceType: string | null;
  allergenFlags: string[];
  supplierIds: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface SubstitutionOption {
  id: string;
  substituteIngredientId: string;
  substituteName: string;
  substitutionCost: number | null;
  feasibilityScore: number | null;
  sensoryImpact: string | null;
  shelfLifeImpact: string | null;
  regulatoryRisk: string | null;
  notes: string | null;
  source: string | null;
}

interface FormulationDetail {
  id: string;
  name: string;
  description: string | null;
  version: number;
  status: FormulationStatus;
  batchSize: number | null;
  batchSizeUnit: string | null;
  totalCost: number | null;
  items: Array<{
    id: string;
    ingredientId: string;
    ingredientName: string;
    quantity: number;
    unit: string;
    percentage: number | null;
    isAlternate: boolean;
    replacesIngredientId: string | null;
    sortOrder: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface ProductDetail {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  brand: string | null;
  markets: string[];
  retailers: string[];
  isActive: boolean;
  annualVolume: number | null;
  annualRevenue: number | null;
  formulations: Array<{
    formulationId: string;
    formulationName: string;
    isCurrent: boolean;
    effectiveDate: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface ProductExposureDetail {
  productId: string;
  productName: string;
  sku: string;
  activeTriggers: Array<{
    triggerId: string;
    title: string;
    severity: string;
    deadlineDate: string | null;
  }>;
  pendingRegulations: Array<{
    ruleId: string;
    description: string;
    jurisdiction: string;
    effectiveDate: string | null;
  }>;
  riskScore: number | null;
  reformulationCost: number | null;
  revenueAtRisk: number;
}

// ============================================================================
// Query key factory
// ============================================================================

export const dataKeys = {
  ingredients: (search?: string, category?: string, page?: number, limit?: number) =>
    ["ingredients", search, category, page, limit] as const,
  ingredientDetail: (id: string) =>
    ["ingredients", id] as const,
  ingredientSubstitutions: (id: string) =>
    ["ingredients", id, "substitutions"] as const,
  formulations: (status?: FormulationStatus, page?: number, limit?: number) =>
    ["formulations", status, page, limit] as const,
  formulationDetail: (id: string) =>
    ["formulations", id] as const,
  products: (search?: string, category?: string, page?: number, limit?: number) =>
    ["products", search, category, page, limit] as const,
  productDetail: (id: string) =>
    ["products", id] as const,
  productExposure: (id: string) =>
    ["products", id, "exposure"] as const,
} as const;

// ============================================================================
// useIngredients
// ============================================================================

export function useIngredients(
  search?: string,
  category?: string,
  page?: number,
  limit?: number
) {
  return useQuery<PaginatedResponse<IngredientWithExposure>, ApiClientError>({
    queryKey: dataKeys.ingredients(search, category, page, limit),
    queryFn: () =>
      apiClient.get<PaginatedResponse<IngredientWithExposure>>(
        "/api/ingredients",
        { search, category, page, limit }
      ),
    staleTime: 60_000,
  });
}

// ============================================================================
// useIngredientDetail
// ============================================================================

export function useIngredientDetail(id: string) {
  return useQuery<IngredientDetail, ApiClientError>({
    queryKey: dataKeys.ingredientDetail(id),
    queryFn: () =>
      apiClient.get<IngredientDetail>(`/api/ingredients/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ============================================================================
// useIngredientSubstitutions
// ============================================================================

export function useIngredientSubstitutions(id: string) {
  return useQuery<SubstitutionOption[], ApiClientError>({
    queryKey: dataKeys.ingredientSubstitutions(id),
    queryFn: () =>
      apiClient.get<SubstitutionOption[]>(`/api/ingredients/${id}/substitutions`),
    enabled: Boolean(id),
    staleTime: 120_000,
  });
}

// ============================================================================
// useFormulations
// ============================================================================

export function useFormulations(
  status?: FormulationStatus,
  page?: number,
  limit?: number
) {
  return useQuery<PaginatedResponse<FormulationDetail>, ApiClientError>({
    queryKey: dataKeys.formulations(status, page, limit),
    queryFn: () =>
      apiClient.get<PaginatedResponse<FormulationDetail>>(
        "/api/formulations",
        { status, page, limit }
      ),
    staleTime: 60_000,
  });
}

// ============================================================================
// useFormulationDetail
// ============================================================================

export function useFormulationDetail(id: string) {
  return useQuery<FormulationDetail, ApiClientError>({
    queryKey: dataKeys.formulationDetail(id),
    queryFn: () =>
      apiClient.get<FormulationDetail>(`/api/formulations/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ============================================================================
// useProducts
// ============================================================================

export function useProducts(
  search?: string,
  category?: string,
  page?: number,
  limit?: number
) {
  return useQuery<PaginatedResponse<ProductWithExposure>, ApiClientError>({
    queryKey: dataKeys.products(search, category, page, limit),
    queryFn: () =>
      apiClient.get<PaginatedResponse<ProductWithExposure>>(
        "/api/products",
        { search, category, page, limit }
      ),
    staleTime: 60_000,
  });
}

// ============================================================================
// useProductDetail
// ============================================================================

export function useProductDetail(id: string) {
  return useQuery<ProductDetail, ApiClientError>({
    queryKey: dataKeys.productDetail(id),
    queryFn: () =>
      apiClient.get<ProductDetail>(`/api/products/${id}`),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

// ============================================================================
// useProductExposure
// ============================================================================

export function useProductExposure(id: string) {
  return useQuery<ProductExposureDetail, ApiClientError>({
    queryKey: dataKeys.productExposure(id),
    queryFn: () =>
      apiClient.get<ProductExposureDetail>(`/api/products/${id}/exposure`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}
