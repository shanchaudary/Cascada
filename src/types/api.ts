// Cascada — API Types
// Type definitions for API request/response shapes.
// These are the contract between frontend and backend.

import type { Plan, UserRole, Severity, TriggerStatus } from "@prisma/client";

// ============================================================================
// Auth types
// ============================================================================
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantSlug: string;
  tenantPlan: Plan;
}

export interface AuthSession {
  user: AuthUser;
  expires: string;
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
}

export interface AuthResponse {
  user: AuthUser;
  tenant: AuthTenant;
  session?: unknown;
}

// ============================================================================
// API Response wrapper
// ============================================================================
export interface ApiResponse<T> {
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    statusCode: number;
    context?: Record<string, unknown>;
    timestamp: string;
  };
}

// ============================================================================
// Paginated list response
// ============================================================================
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================================
// ERP Connection types
// ============================================================================
export interface ErpConnectionStatus {
  id: string;
  erpType: string;
  connectionName: string;
  syncStatus: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  recordsSynced: number;
}

// ============================================================================
// Ingredient types
// ============================================================================
export interface IngredientWithExposure {
  id: string;
  name: string;
  casNumber: string | null;
  eenumber: string | null;
  category: string | null;
  isSynthetic: boolean | null;
  sourceType: string | null;
  allergenFlags: string[];
  formulationCount: number;
  productCount: number;
  activeRegulations: number;
  pendingRegulations: number;
  riskLevel: Severity | null;
}

// ============================================================================
// Product types
// ============================================================================
export interface ProductWithExposure {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  brand: string | null;
  markets: string[];
  retailers: string[];
  annualRevenue: number | null;
  annualVolume: number | null;
  activeTriggers: number;
  pendingRegulations: number;
  riskScore: number | null;
  reformulationCost: number | null;
}

// ============================================================================
// Cascade types
// ============================================================================
export interface CascadeGraphStats {
  nodeCount: number;
  edgeCount: number;
  nodeTypes: Record<string, number>;
  edgeTypes: Record<string, number>;
  lastRebuiltAt: string;
  tenantId: string;
}

export interface CascadeTriggerSummary {
  id: string;
  title: string;
  severity: Severity;
  status: TriggerStatus;
  triggerType: string;
  totalSkusAffected: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  deadlineDate: string | null;
  createdAt: string;
}

export interface CascadeExposureSummary {
  byState: Record<string, { skuCount: number; revenueAtRisk: number }>;
  byProduct: Array<{
    productId: string;
    productName: string;
    sku: string;
    revenueAtRisk: number;
    triggers: number;
  }>;
  bySeverity: Record<Severity, number>;
  totalSkusAffected: number;
  totalRevenueAtRisk: number;
}

// ============================================================================
// Decision Package types
// ============================================================================
export interface DecisionPackageSummary {
  id: string;
  title: string;
  recommendation: string;
  totalSkusAffected: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  deadlineDate: string | null;
  decision: string | null;
  generatedAt: string;
}

// ============================================================================
// Dashboard types
// ============================================================================
export interface DashboardSummary {
  activeTriggers: number;
  criticalTriggers: number;
  skusAtRisk: number;
  revenueAtRisk: number;
  upcomingDeadlines: number;
  recentRegulations: number;
  pendingDecisions: number;
  activeWorkflows: number;
}

export interface ExposureByState {
  state: string;
  jurisdiction: string;
  skuCount: number;
  revenueAtRisk: number;
  regulationCount: number;
  topRegulations: Array<{ id: string; name: string; severity: Severity }>;
}

export interface UpcomingDeadline {
  id: string;
  title: string;
  deadline: string;
  severity: Severity;
  skusAffected: number;
  daysRemaining: number;
}

// ============================================================================
// Agent types
// ============================================================================
export interface AgentConversation {
  id: string;
  createdAt: string;
  lastMessageAt: string;
  messageCount: number;
  title: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Array<{
    sourceId: string;
    sourceName: string;
    sourceUrl: string;
    relevance: number;
  }>;
  createdAt: string;
}

// ============================================================================
// Diagnostic types
// ============================================================================
export interface DiagnosticFormData {
  companyName: string;
  contactEmail: string;
  contactName: string;
  productCategories: string[];
  markets: string[];
  ingredientsOfConcern?: string[];
  erpSystem?: string;
}

export interface DiagnosticResultData {
  exposureByState: Record<string, number>;
  totalSkusAtRisk: number;
  estimatedComplianceCost: { min: number; max: number };
  topRegulatoryRisks: Array<{
    regulation: string;
    jurisdiction: string;
    severity: Severity;
    affectedCategories: string[];
  }>;
  recommendations: string[];
  generatedAt: string;
}
