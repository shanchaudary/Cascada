// Cascada — ERP Connector Shared Types
// Internal types for the ERP connector infrastructure.
// These complement the public-facing types in src/types/erp.ts.

import type { ErpType } from "@prisma/client";
import type {
  ErpIngredient,
  ErpFormulation,
  ErpFormulationItem,
  ErpProduct,
  ErpCustomer,
  ErpSupplier,
  SyncWatermark,
  SyncResult,
  SyncError,
  FieldMapping,
  FieldMappingConfig,
  ErpConnectionTestResult,
} from "../../types/erp";

// ============================================================================
// ERP HTTP client types
// ============================================================================

/** Configuration for the ERP HTTP client shared across all connectors. */
export interface ErpHttpClientConfig {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  rateLimitPerMinute: number;
  defaultHeaders?: Record<string, string>;
}

/** Internal HTTP request options passed to the client. */
export interface ErpRequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  queryParams?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** ID of the entity being fetched — for logging/error context */
  entityContext?: string;
}

/** Raw response wrapper from ERP API calls. */
export interface ErpRawResponse<T = unknown> {
  statusCode: number;
  headers: Record<string, string>;
  data: T;
  latencyMs: number;
  rateLimitRemaining?: number;
  rateLimitResetAt?: string;
}

/** Paginated response from ERP list endpoints. */
export interface ErpPaginatedResponse<T> {
  items: T[];
  totalCount: number;
  hasMore: boolean;
  nextCursor?: string;
  nextOffset?: number;
}

/** Pagination parameters for ERP list queries. */
export interface ErpPaginationParams {
  limit: number;
  offset?: number;
  cursor?: string;
  /** Last modified timestamp for incremental syncs */
  modifiedSince?: string;
}

// ============================================================================
// ERP rate limiting
// ============================================================================

/** Tracks rate limit state for an ERP connection. */
export interface ErpRateLimitState {
  requestsInWindow: number;
  windowStartMs: number;
  windowDurationMs: number;
  maxRequestsPerWindow: number;
  /** Minimum delay between consecutive requests (ms) */
  minRequestIntervalMs: number;
  lastRequestAtMs: number;
}

/** Rate limit configuration per ERP type. */
export const ERP_RATE_LIMITS: Record<ErpType, ErpRateLimitConfig> = {
  NETSUITE: {
    requestsPerWindow: 200,
    windowDurationMs: 60_000,
    minRequestIntervalMs: 50,
    burstAllowance: 10,
    backoffMultiplier: 2,
  },
  SAP_B1: {
    requestsPerWindow: 300,
    windowDurationMs: 60_000,
    minRequestIntervalMs: 33,
    burstAllowance: 15,
    backoffMultiplier: 2,
  },
  DYNAMICS_365_BC: {
    requestsPerWindow: 300,
    windowDurationMs: 60_000,
    minRequestIntervalMs: 33,
    burstAllowance: 15,
    backoffMultiplier: 2,
  },
  INFOR_M3: {
    requestsPerWindow: 120,
    windowDurationMs: 60_000,
    minRequestIntervalMs: 100,
    burstAllowance: 5,
    backoffMultiplier: 2,
  },
  EPICOR_P21: {
    requestsPerWindow: 200,
    windowDurationMs: 60_000,
    minRequestIntervalMs: 50,
    burstAllowance: 10,
    backoffMultiplier: 2,
  },
};

export interface ErpRateLimitConfig {
  requestsPerWindow: number;
  windowDurationMs: number;
  minRequestIntervalMs: number;
  burstAllowance: number;
  backoffMultiplier: number;
}

// ============================================================================
// ERP auth lifecycle
// ============================================================================

/** Authentication state managed by each connector. */
export interface ErpAuthState {
  /** Whether the connector currently has a valid session/token */
  isAuthenticated: boolean;
  /** When the current token/session expires (if applicable) */
  expiresAt?: string;
  /** Token type: oauth2, session, basic, api_key */
  authType: "oauth2" | "session" | "basic" | "api_key";
  /** When the auth was last refreshed */
  lastRefreshedAt?: string;
  /** Number of consecutive auth failures */
  consecutiveFailures: number;
}

// ============================================================================
// ERP sync configuration per type
// ============================================================================

export const ERP_SYNC_DEFAULTS: Record<ErpType, ErpTypeSyncConfig> = {
  NETSUITE: {
    defaultBatchSize: 100,
    maxBatchSize: 1000,
    incrementalSupported: true,
    watermarkField: "lastModifiedDate",
    supportedEntities: ["ingredients", "formulations", "products", "customers", "suppliers"],
    entityEndpoints: {
      ingredients: "/services/rest/record/v1/inventoryItem",
      formulations: "/services/rest/record/v1/assemblyItem",
      products: "/services/rest/record/v1/assemblyBuild",
      customers: "/services/rest/record/v1/customer",
      suppliers: "/services/rest/record/v1/vendor",
    },
  },
  SAP_B1: {
    defaultBatchSize: 100,
    maxBatchSize: 500,
    incrementalSupported: true,
    watermarkField: "UpdateDate",
    supportedEntities: ["ingredients", "formulations", "products", "customers", "suppliers"],
    entityEndpoints: {
      ingredients: "/Items",
      formulations: "/ProductTrees",
      products: "/Items($filter='ItemType eq itItems')",
      customers: "/BusinessPartners($filter='CardType eq cCustomer')",
      suppliers: "/BusinessPartners($filter='CardType eq cSupplier')",
    },
  },
  DYNAMICS_365_BC: {
    defaultBatchSize: 100,
    maxBatchSize: 1000,
    incrementalSupported: true,
    watermarkField: "lastModifiedDateTime",
    supportedEntities: ["ingredients", "formulations", "products", "customers", "suppliers"],
    entityEndpoints: {
      ingredients: "/items",
      formulations: "/productionBOMs",
      products: "/items",
      customers: "/customers",
      suppliers: "/vendors",
    },
  },
  INFOR_M3: {
    defaultBatchSize: 50,
    maxBatchSize: 200,
    incrementalSupported: true,
    watermarkField: "CHDT",
    supportedEntities: ["ingredients", "formulations", "products", "customers", "suppliers"],
    entityEndpoints: {
      ingredients: "/MMS002MI/GetMitmas",
      formulations: "/PDS001MI/GetMthdHead",
      products: "/MMS002MI/GetMitmas",
      customers: "/CRS610MI/GetCustHead",
      suppliers: "/CRS620MI/GetSupHead",
    },
  },
  EPICOR_P21: {
    defaultBatchSize: 100,
    maxBatchSize: 500,
    incrementalSupported: true,
    watermarkField: "LastUpdateDate",
    supportedEntities: ["ingredients", "formulations", "products", "customers", "suppliers"],
    entityEndpoints: {
      ingredients: "/api/v1/ics/invitems",
      formulations: "/api/v1/engr/boms",
      products: "/api/v1/ics/invitems",
      customers: "/api/v1/arp/customers",
      suppliers: "/api/v1/apm/vendors",
    },
  },
};

export interface ErpTypeSyncConfig {
  defaultBatchSize: number;
  maxBatchSize: number;
  incrementalSupported: boolean;
  watermarkField: string;
  supportedEntities: string[];
  entityEndpoints: Record<string, string>;
}

// ============================================================================
// ERP field transform engine
// ============================================================================

/** Result of applying field mappings to a raw ERP record. */
export interface FieldTransformResult<T> {
  data: T;
  unmappedFields: string[];
  transformErrors: Array<{
    field: string;
    erpField: string;
    error: string;
    rawValue: unknown;
  }>;
}

/** Context passed to field transform functions. */
export interface FieldTransformContext {
  entityType: "ingredient" | "formulation" | "product" | "customer" | "supplier";
  erpType: ErpType;
  connectionId: string;
  fieldMappings: FieldMappingConfig;
}

// ============================================================================
// ERP conflict resolution
// ============================================================================

/** Describes how to resolve sync conflicts between ERP and local data. */
export type ConflictResolutionStrategy =
  | "erp_wins"        // Always prefer ERP data
  | "local_wins"      // Always prefer local data
  | "newer_wins"      // Use the most recently modified record
  | "manual"          // Flag for manual resolution
  | "merge";          // Merge non-overlapping fields

/** A detected conflict between ERP and local data. */
export interface SyncConflict {
  entityType: string;
  erpId: string;
  localId: string;
  fieldName: string;
  erpValue: unknown;
  localValue: unknown;
  erpModifiedAt: string;
  localModifiedAt: string;
  resolution: ConflictResolutionStrategy;
  resolvedValue?: unknown;
}

/** Result of conflict resolution for a single sync run. */
export interface ConflictResolutionResult {
  totalConflicts: number;
  autoResolved: number;
  manualPending: number;
  erpWins: number;
  localWins: number;
  merged: number;
  newerWins: number;
}

// ============================================================================
// ERP connector factory types
// ============================================================================

/** Parameters for creating an ERP connector instance. */
export interface ErpConnectorParams {
  erpType: ErpType;
  connectionId: string;
  tenantId: string;
  connectionString: string;
  authConfig: Record<string, unknown>;
  fieldMappings: FieldMappingConfig;
  syncState: Record<string, unknown>;
}

/** Health check result from a connector with additional diagnostic info. */
export interface ErpDetailedHealthStatus {
  connected: boolean;
  latencyMs: number;
  lastSuccessfulSync: string | null;
  pendingSyncs: number;
  authState: ErpAuthState;
  rateLimitState: ErpRateLimitState;
  apiVersion: string | null;
  errors: Array<{
    timestamp: string;
    message: string;
    code?: string;
  }>;
}

// ============================================================================
// ERP sync execution context
// ============================================================================

/** Context object passed through the sync engine for a single sync operation. */
export interface SyncExecutionContext {
  tenantId: string;
  connectionId: string;
  erpType: ErpType;
  syncType: "full" | "incremental";
  entityType: string;
  watermark?: SyncWatermark;
  batchSize: number;
  fieldMappings: FieldMappingConfig;
  conflictStrategy: ConflictResolutionStrategy;
  startedAt: string;
  /** Accumulated errors during this sync */
  errors: SyncError[];
  /** Accumulated conflicts during this sync */
  conflicts: SyncConflict[];
  /** Number of records successfully processed */
  recordsProcessed: number;
  /** Number of records created locally */
  recordsCreated: number;
  /** Number of records updated locally */
  recordsUpdated: number;
  /** Number of records that failed to process */
  recordsFailed: number;
}

// ============================================================================
// Re-export public types for convenience
// ============================================================================

export type {
  ErpIngredient,
  ErpFormulation,
  ErpFormulationItem,
  ErpProduct,
  ErpCustomer,
  ErpSupplier,
  SyncWatermark,
  SyncResult,
  SyncError,
  FieldMapping,
  FieldMappingConfig,
  ErpConnectionTestResult,
};
