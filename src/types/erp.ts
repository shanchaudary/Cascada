// Cascada — ERP Type Definitions
// Shared types for all ERP connector implementations.
// Each ERP connector must conform to these interfaces.

import type { ErpType } from "@prisma/client";

// ============================================================================
// Core ERP entity types
// ============================================================================
export interface ErpIngredient {
  erpId: string;
  name: string;
  alternateNames: string[];
  casNumber?: string;
  eenumber?: string;
  category?: string;
  isSynthetic?: boolean;
  sourceType?: string;
  allergenFlags: string[];
  supplierIds: string[];
  unitOfMeasure?: string;
  costPerUnit?: number;
  metadata?: Record<string, unknown>;
}

export interface ErpFormulation {
  erpId: string;
  name: string;
  description?: string;
  version: number;
  status: string;
  batchSize?: number;
  batchSizeUnit?: string;
  items: ErpFormulationItem[];
  totalCost?: number;
}

export interface ErpFormulationItem {
  ingredientErpId: string;
  quantity: number;
  unit: string;
  percentage?: number;
  isAlternate: boolean;
  replacesIngredientErpId?: string;
  sortOrder: number;
}

export interface ErpProduct {
  erpId: string;
  name: string;
  sku: string;
  category?: string;
  brand?: string;
  markets: string[];
  retailers: string[];
  isActive: boolean;
  annualVolume?: number;
  annualRevenue?: number;
  formulationErpIds: string[];
}

export interface ErpCustomer {
  erpId: string;
  name: string;
  type: string;
  requirements?: Record<string, unknown>;
  contactEmail?: string;
  productErpIds: string[];
}

export interface ErpSupplier {
  erpId: string;
  name: string;
  contactEmail?: string;
  certifications: string[];
  ingredientErpIds: string[];
  riskScore?: number;
}

// ============================================================================
// ERP Connector interface — every connector must implement this
// ============================================================================
export interface IErpConnector {
  readonly erpType: ErpType;
  readonly connectionId: string;

  // Connection lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<ErpConnectionTestResult>;

  // Data sync operations
  syncIngredients(watermark?: SyncWatermark): Promise<SyncResult<ErpIngredient>>;
  syncFormulations(watermark?: SyncWatermark): Promise<SyncResult<ErpFormulation>>;
  syncProducts(watermark?: SyncWatermark): Promise<SyncResult<ErpProduct>>;
  syncCustomers(watermark?: SyncWatermark): Promise<SyncResult<ErpCustomer>>;
  syncSuppliers(watermark?: SyncWatermark): Promise<SyncResult<ErpSupplier>>;

  // Full sync — all entity types
  fullSync(): Promise<MultiEntitySyncResult>;

  // Health check
  getHealthStatus(): Promise<ErpHealthStatus>;
}

// ============================================================================
// Sync types
// ============================================================================
export interface SyncWatermark {
  lastSyncTimestamp: string; // ISO 8601
  cursor?: string;          // Pagination cursor for incremental syncs
  offset?: number;
}

export interface SyncResult<T> {
  entityType: string;
  syncType: "full" | "incremental";
  recordsTotal: number;
  recordsSuccess: number;
  recordsFailed: number;
  errors: SyncError[];
  data: T[];
  nextWatermark?: SyncWatermark;
  durationMs: number;
}

export interface MultiEntitySyncResult {
  ingredients: SyncResult<ErpIngredient>;
  formulations: SyncResult<ErpFormulation>;
  products: SyncResult<ErpProduct>;
  customers: SyncResult<ErpCustomer>;
  suppliers: SyncResult<ErpSupplier>;
  totalDurationMs: number;
}

export interface SyncError {
  erpId?: string;
  entityType: string;
  errorCode: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ErpConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
  serverInfo?: string;
  permissions?: string[];
}

export interface ErpHealthStatus {
  connected: boolean;
  latencyMs: number;
  lastSuccessfulSync: string | null;
  pendingSyncs: number;
  errors: Array<{
    timestamp: string;
    message: string;
  }>;
}

// ============================================================================
// ERP-specific auth config types
// ============================================================================
export interface NetSuiteAuthConfig {
  accountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
  baseUrl: string;
}

export interface SapB1AuthConfig {
  server: string;
  companyDb: string;
  username: string;
  password: string;
  baseUrl: string;
}

export interface Dynamics365AuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  environment: string;
  companyId: string;
  baseUrl: string;
}

export interface InforM3AuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  organization: string;
  baseUrl: string;
}

export interface EpicorP21AuthConfig {
  server: string;
  company: string;
  username: string;
  password: string;
  baseUrl: string;
}

// ============================================================================
// ERP field mapping types
// ============================================================================
export interface FieldMapping {
  localField: string;
  erpField: string;
  transform?: "none" | "uppercase" | "lowercase" | "trim" | "parse_number" | "parse_date";
  defaultValue?: unknown;
  required: boolean;
}

export interface FieldMappingConfig {
  ingredient: FieldMapping[];
  formulation: FieldMapping[];
  product: FieldMapping[];
  customer: FieldMapping[];
  supplier: FieldMapping[];
}
