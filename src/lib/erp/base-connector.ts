// Cascada — ERP Base Connector
// Abstract base class that all 5 ERP connectors implement.
// Provides: HTTP client with rate limiting, retry with backoff, auth lifecycle,
// field mapping transforms, pagination, and sync state management.

import type { ErpType } from "@prisma/client";
import type {
  IErpConnector,
  ErpConnectionTestResult,
  ErpHealthStatus,
  SyncResult,
  SyncWatermark,
  MultiEntitySyncResult,
  FieldMappingConfig,
} from "../../types/erp";
import type {
  ErpHttpClientConfig,
  ErpRequestOptions,
  ErpRawResponse,
  ErpPaginatedResponse,
  ErpPaginationParams,
  ErpRateLimitState,
  ErpAuthState,
  ErpConnectorParams,
  ErpDetailedHealthStatus,
  SyncExecutionContext,
  ConflictResolutionStrategy,
  SyncConflict,
  FieldTransformResult,
  FieldTransformContext,
  ErpRateLimitConfig,
  ERP_RATE_LIMITS,
} from "./types";
import {
  ErpConnectionError,
  ErpSyncError,
  ErpAuthError,
} from "../errors";
import { createErpSyncLogger } from "../logger";
import { ERP_SYNC_CONFIG } from "../constants";

// ============================================================================
// Abstract Base Connector
// ============================================================================

/**
 * Abstract base class for all ERP connectors.
 *
 * Every ERP connector (NetSuite, SAP B1, D365 BC, Infor M3, Epicor P21)
 * must extend this class and implement the abstract methods for:
 * - Authentication (connect/disconnect/refreshAuth)
 * - Entity fetching (fetchIngredients, fetchFormulations, etc.)
 * - Entity mapping (mapToIngredient, mapToFormulation, etc.)
 * - Connection testing (testConnection)
 *
 * The base class provides:
 * - HTTP client with automatic rate limiting
 * - Retry with exponential backoff + jitter
 * - Field mapping transform engine
 * - Pagination handling
 * - Sync state watermark management
 * - Conflict detection and resolution
 */
export abstract class BaseErpConnector implements IErpConnector {
  abstract readonly erpType: ErpType;
  readonly connectionId: string;

  protected tenantId: string;
  protected connectionString: string;
  protected authConfig: Record<string, unknown>;
  protected fieldMappings: FieldMappingConfig;
  protected syncState: Record<string, unknown>;
  protected httpClientConfig: ErpHttpClientConfig;
  protected rateLimitState: ErpRateLimitState;
  protected authState: ErpAuthState;
  protected logger: ReturnType<typeof createErpSyncLogger>;

  constructor(params: ErpConnectorParams) {
    this.connectionId = params.connectionId;
    this.tenantId = params.tenantId;
    this.connectionString = params.connectionString;
    this.authConfig = params.authConfig;
    this.fieldMappings = params.fieldMappings;
    this.syncState = params.syncState;

    this.httpClientConfig = this.buildHttpClientConfig();
    this.rateLimitState = this.initializeRateLimitState();
    this.authState = {
      isAuthenticated: false,
      authType: "oauth2",
      consecutiveFailures: 0,
    };
    this.logger = createErpSyncLogger(
      params.erpType,
      params.connectionId,
      "base"
    );
  }

  // ==========================================================================
  // Abstract methods — each connector MUST implement these
  // ==========================================================================

  /** Establish connection and authenticate with the ERP system. */
  abstract connect(): Promise<void>;

  /** Disconnect and clean up any active sessions/tokens. */
  abstract disconnect(): Promise<void>;

  /** Test the connection by making a lightweight API call. */
  abstract testConnection(): Promise<ErpConnectionTestResult>;

  /** Refresh authentication token/session if expired. */
  protected abstract refreshAuth(): Promise<void>;

  /** Get the ERP API version string. */
  protected abstract getApiVersion(): Promise<string | null>;

  // --- Entity fetching (raw ERP data) ---

  /** Fetch raw ingredient records from the ERP. */
  protected abstract fetchRawIngredients(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>>;

  /** Fetch raw formulation/BOM records from the ERP. */
  protected abstract fetchRawFormulations(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>>;

  /** Fetch raw product records from the ERP. */
  protected abstract fetchRawProducts(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>>;

  /** Fetch raw customer records from the ERP. */
  protected abstract fetchRawCustomers(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>>;

  /** Fetch raw supplier/vendor records from the ERP. */
  protected abstract fetchRawSuppliers(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>>;

  // --- Entity mapping (raw ERP → internal types) ---

  /** Map a raw ERP ingredient record to our internal ErpIngredient type. */
  protected abstract mapToIngredient(
    raw: Record<string, unknown>
  ): Promise<FieldTransformResult<import("../../types/erp").ErpIngredient>>;

  /** Map a raw ERP formulation record to our internal ErpFormulation type. */
  protected abstract mapToFormulation(
    raw: Record<string, unknown>
  ): Promise<FieldTransformResult<import("../../types/erp").ErpFormulation>>;

  /** Map a raw ERP product record to our internal ErpProduct type. */
  protected abstract mapToProduct(
    raw: Record<string, unknown>
  ): Promise<FieldTransformResult<import("../../types/erp").ErpProduct>>;

  /** Map a raw ERP customer record to our internal ErpCustomer type. */
  protected abstract mapToCustomer(
    raw: Record<string, unknown>
  ): Promise<FieldTransformResult<import("../../types/erp").ErpCustomer>>;

  /** Map a raw ERP supplier record to our internal ErpSupplier type. */
  protected abstract mapToSupplier(
    raw: Record<string, unknown>
  ): Promise<FieldTransformResult<import("../../types/erp").ErpSupplier>>;

  // ==========================================================================
  // Concrete methods — shared logic for all connectors
  // ==========================================================================

  /**
   * Execute an HTTP request with rate limiting, retry, and auth refresh.
   * This is the single entry point for all ERP API communication.
   */
  protected async executeRequest<T>(
    options: ErpRequestOptions
  ): Promise<ErpRawResponse<T>> {
    await this.ensureAuthenticated();
    await this.enforceRateLimit();

    const maxRetries = this.httpClientConfig.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const response = await this.doHttpRequest<T>(options);
        const latencyMs = Date.now() - startTime;

        // Update rate limit state from response headers
        this.updateRateLimitFromResponse(response);

        this.logger.debug(
          {
            method: options.method,
            path: options.path,
            statusCode: response.statusCode,
            latencyMs,
            attempt,
          },
          "ERP API request completed"
        );

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isRetryable = this.isRetryableError(lastError);

        if (!isRetryable || attempt === maxRetries) {
          break;
        }

        const delay = this.calculateBackoffDelay(attempt);
        this.logger.warn(
          {
            method: options.method,
            path: options.path,
            attempt,
            nextRetryInMs: delay,
            error: lastError.message,
          },
          "ERP API request failed, retrying"
        );

        await this.sleep(delay);
      }
    }

    throw new ErpConnectionError(
      this.erpType,
      `Request failed after ${maxRetries + 1} attempts: ${lastError?.message ?? "unknown error"}`,
      {
        method: options.method,
        path: options.path,
        lastError: lastError?.message,
      }
    );
  }

  /**
   * Fetch all pages of a paginated ERP endpoint.
   * Handles cursor/offset-based pagination automatically.
   */
  protected async fetchAllPages<T>(
    fetchFn: (pagination: ErpPaginationParams) => Promise<ErpPaginatedResponse<T>>,
    watermark?: SyncWatermark,
    batchSize?: number
  ): Promise<T[]> {
    const allItems: T[] = [];
    let hasMore = true;
    let offset = watermark?.offset ?? 0;
    let cursor = watermark?.cursor;
    const limit = batchSize ?? ERP_SYNC_CONFIG.BATCH_SIZE;

    while (hasMore) {
      const pagination: ErpPaginationParams = {
        limit,
        offset,
        cursor,
        modifiedSince: watermark?.lastSyncTimestamp,
      };

      const response = await fetchFn(pagination);
      allItems.push(...response.items);

      hasMore = response.hasMore;
      if (response.nextCursor) {
        cursor = response.nextCursor;
      } else {
        offset += response.items.length;
      }

      // Safety: prevent infinite loops
      if (response.items.length === 0) {
        break;
      }

      // Enforce rate limit between pages
      await this.enforceRateLimit();
    }

    return allItems;
  }

  // ==========================================================================
  // Sync operations — concrete implementations using abstract entity methods
  // ==========================================================================

  async syncIngredients(watermark?: SyncWatermark): Promise<SyncResult<import("../../types/erp").ErpIngredient>> {
    const startTime = Date.now();
    const syncLogger = createErpSyncLogger(this.erpType, this.connectionId, "ingredients");

    try {
      syncLogger.info({ syncType: watermark ? "incremental" : "full" }, "Starting ingredient sync");

      const rawRecords = await this.fetchAllPages(
        (p) => this.fetchRawIngredients(p),
        watermark
      );

      const mapped: import("../../types/erp").ErpIngredient[] = [];
      const errors: import("../../types/erp").SyncError[] = [];

      for (const raw of rawRecords) {
        try {
          const result = await this.mapToIngredient(raw);
          mapped.push(result.data);

          if (result.transformErrors.length > 0) {
            syncLogger.warn(
              { erpId: result.data.erpId, errors: result.transformErrors },
              "Field mapping errors during ingredient transform"
            );
          }
        } catch (error) {
          errors.push({
            erpId: raw["id"] as string | undefined ?? raw["itemId"] as string | undefined,
            entityType: "ingredients",
            errorCode: "MAPPING_ERROR",
            message: error instanceof Error ? error.message : String(error),
            details: { rawRecord: raw },
          });
        }
      }

      const durationMs = Date.now() - startTime;
      syncLogger.info(
        { total: rawRecords.length, mapped: mapped.length, errors: errors.length, durationMs },
        "Ingredient sync completed"
      );

      return {
        entityType: "ingredients",
        syncType: watermark ? "incremental" : "full",
        recordsTotal: rawRecords.length,
        recordsSuccess: mapped.length,
        recordsFailed: errors.length,
        errors,
        data: mapped,
        nextWatermark: this.computeNextWatermark(rawRecords),
        durationMs,
      };
    } catch (error) {
      throw new ErpSyncError(
        this.erpType,
        "ingredients",
        error instanceof Error ? error.message : String(error),
        { watermark }
      );
    }
  }

  async syncFormulations(watermark?: SyncWatermark): Promise<SyncResult<import("../../types/erp").ErpFormulation>> {
    const startTime = Date.now();
    const syncLogger = createErpSyncLogger(this.erpType, this.connectionId, "formulations");

    try {
      syncLogger.info({ syncType: watermark ? "incremental" : "full" }, "Starting formulation sync");

      const rawRecords = await this.fetchAllPages(
        (p) => this.fetchRawFormulations(p),
        watermark
      );

      const mapped: import("../../types/erp").ErpFormulation[] = [];
      const errors: import("../../types/erp").SyncError[] = [];

      for (const raw of rawRecords) {
        try {
          const result = await this.mapToFormulation(raw);
          mapped.push(result.data);
        } catch (error) {
          errors.push({
            erpId: raw["id"] as string | undefined ?? raw["bomId"] as string | undefined,
            entityType: "formulations",
            errorCode: "MAPPING_ERROR",
            message: error instanceof Error ? error.message : String(error),
            details: { rawRecord: raw },
          });
        }
      }

      const durationMs = Date.now() - startTime;
      syncLogger.info(
        { total: rawRecords.length, mapped: mapped.length, errors: errors.length, durationMs },
        "Formulation sync completed"
      );

      return {
        entityType: "formulations",
        syncType: watermark ? "incremental" : "full",
        recordsTotal: rawRecords.length,
        recordsSuccess: mapped.length,
        recordsFailed: errors.length,
        errors,
        data: mapped,
        nextWatermark: this.computeNextWatermark(rawRecords),
        durationMs,
      };
    } catch (error) {
      throw new ErpSyncError(
        this.erpType,
        "formulations",
        error instanceof Error ? error.message : String(error),
        { watermark }
      );
    }
  }

  async syncProducts(watermark?: SyncWatermark): Promise<SyncResult<import("../../types/erp").ErpProduct>> {
    const startTime = Date.now();
    const syncLogger = createErpSyncLogger(this.erpType, this.connectionId, "products");

    try {
      syncLogger.info({ syncType: watermark ? "incremental" : "full" }, "Starting product sync");

      const rawRecords = await this.fetchAllPages(
        (p) => this.fetchRawProducts(p),
        watermark
      );

      const mapped: import("../../types/erp").ErpProduct[] = [];
      const errors: import("../../types/erp").SyncError[] = [];

      for (const raw of rawRecords) {
        try {
          const result = await this.mapToProduct(raw);
          mapped.push(result.data);
        } catch (error) {
          errors.push({
            erpId: raw["id"] as string | undefined ?? raw["sku"] as string | undefined,
            entityType: "products",
            errorCode: "MAPPING_ERROR",
            message: error instanceof Error ? error.message : String(error),
            details: { rawRecord: raw },
          });
        }
      }

      const durationMs = Date.now() - startTime;
      syncLogger.info(
        { total: rawRecords.length, mapped: mapped.length, errors: errors.length, durationMs },
        "Product sync completed"
      );

      return {
        entityType: "products",
        syncType: watermark ? "incremental" : "full",
        recordsTotal: rawRecords.length,
        recordsSuccess: mapped.length,
        recordsFailed: errors.length,
        errors,
        data: mapped,
        nextWatermark: this.computeNextWatermark(rawRecords),
        durationMs,
      };
    } catch (error) {
      throw new ErpSyncError(
        this.erpType,
        "products",
        error instanceof Error ? error.message : String(error),
        { watermark }
      );
    }
  }

  async syncCustomers(watermark?: SyncWatermark): Promise<SyncResult<import("../../types/erp").ErpCustomer>> {
    const startTime = Date.now();
    const syncLogger = createErpSyncLogger(this.erpType, this.connectionId, "customers");

    try {
      syncLogger.info({ syncType: watermark ? "incremental" : "full" }, "Starting customer sync");

      const rawRecords = await this.fetchAllPages(
        (p) => this.fetchRawCustomers(p),
        watermark
      );

      const mapped: import("../../types/erp").ErpCustomer[] = [];
      const errors: import("../../types/erp").SyncError[] = [];

      for (const raw of rawRecords) {
        try {
          const result = await this.mapToCustomer(raw);
          mapped.push(result.data);
        } catch (error) {
          errors.push({
            erpId: raw["id"] as string | undefined ?? raw["customerId"] as string | undefined,
            entityType: "customers",
            errorCode: "MAPPING_ERROR",
            message: error instanceof Error ? error.message : String(error),
            details: { rawRecord: raw },
          });
        }
      }

      const durationMs = Date.now() - startTime;
      syncLogger.info(
        { total: rawRecords.length, mapped: mapped.length, errors: errors.length, durationMs },
        "Customer sync completed"
      );

      return {
        entityType: "customers",
        syncType: watermark ? "incremental" : "full",
        recordsTotal: rawRecords.length,
        recordsSuccess: mapped.length,
        recordsFailed: errors.length,
        errors,
        data: mapped,
        nextWatermark: this.computeNextWatermark(rawRecords),
        durationMs,
      };
    } catch (error) {
      throw new ErpSyncError(
        this.erpType,
        "customers",
        error instanceof Error ? error.message : String(error),
        { watermark }
      );
    }
  }

  async syncSuppliers(watermark?: SyncWatermark): Promise<SyncResult<import("../../types/erp").ErpSupplier>> {
    const startTime = Date.now();
    const syncLogger = createErpSyncLogger(this.erpType, this.connectionId, "suppliers");

    try {
      syncLogger.info({ syncType: watermark ? "incremental" : "full" }, "Starting supplier sync");

      const rawRecords = await this.fetchAllPages(
        (p) => this.fetchRawSuppliers(p),
        watermark
      );

      const mapped: import("../../types/erp").ErpSupplier[] = [];
      const errors: import("../../types/erp").SyncError[] = [];

      for (const raw of rawRecords) {
        try {
          const result = await this.mapToSupplier(raw);
          mapped.push(result.data);
        } catch (error) {
          errors.push({
            erpId: raw["id"] as string | undefined ?? raw["vendorId"] as string | undefined,
            entityType: "suppliers",
            errorCode: "MAPPING_ERROR",
            message: error instanceof Error ? error.message : String(error),
            details: { rawRecord: raw },
          });
        }
      }

      const durationMs = Date.now() - startTime;
      syncLogger.info(
        { total: rawRecords.length, mapped: mapped.length, errors: errors.length, durationMs },
        "Supplier sync completed"
      );

      return {
        entityType: "suppliers",
        syncType: watermark ? "incremental" : "full",
        recordsTotal: rawRecords.length,
        recordsSuccess: mapped.length,
        recordsFailed: errors.length,
        errors,
        data: mapped,
        nextWatermark: this.computeNextWatermark(rawRecords),
        durationMs,
      };
    } catch (error) {
      throw new ErpSyncError(
        this.erpType,
        "suppliers",
        error instanceof Error ? error.message : String(error),
        { watermark }
      );
    }
  }

  /**
   * Execute a full sync across all entity types.
   * Each entity type is synced sequentially to avoid rate limit issues.
   */
  async fullSync(): Promise<MultiEntitySyncResult> {
    const totalStartTime = Date.now();

    this.logger.info("Starting full sync across all entity types");

    const [ingredients, formulations, products, customers, suppliers] =
      await Promise.all([
        this.syncIngredients(),
        this.syncFormulations(),
        this.syncProducts(),
        this.syncCustomers(),
        this.syncSuppliers(),
      ]);

    const totalDurationMs = Date.now() - totalStartTime;

    this.logger.info(
      {
        totalDurationMs,
        ingredientCount: ingredients.recordsSuccess,
        formulationCount: formulations.recordsSuccess,
        productCount: products.recordsSuccess,
        customerCount: customers.recordsSuccess,
        supplierCount: suppliers.recordsSuccess,
      },
      "Full sync completed across all entity types"
    );

    return {
      ingredients,
      formulations,
      products,
      customers,
      suppliers,
      totalDurationMs,
    };
  }

  /**
   * Get the current health status of this ERP connection.
   * Makes a lightweight API call to verify connectivity.
   */
  async getHealthStatus(): Promise<ErpHealthStatus> {
    try {
      const testResult = await this.testConnection();
      return {
        connected: testResult.success,
        latencyMs: testResult.latencyMs,
        lastSuccessfulSync: this.getLastSuccessfulSyncTime(),
        pendingSyncs: 0,
        errors: [],
      };
    } catch (error) {
      return {
        connected: false,
        latencyMs: -1,
        lastSuccessfulSync: this.getLastSuccessfulSyncTime(),
        pendingSyncs: 0,
        errors: [
          {
            timestamp: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  }

  /**
   * Get detailed health status including auth state, rate limits, and API version.
   */
  async getDetailedHealthStatus(): Promise<ErpDetailedHealthStatus> {
    const basicHealth = await this.getHealthStatus();
    let apiVersion: string | null = null;

    try {
      apiVersion = await this.getApiVersion();
    } catch {
      // Non-critical — API version is informational
    }

    return {
      ...basicHealth,
      authState: { ...this.authState },
      rateLimitState: { ...this.rateLimitState },
      apiVersion,
    };
  }

  // ==========================================================================
  // Field mapping transform engine
  // ==========================================================================

  /**
   * Apply field mappings to transform a raw ERP record into the target shape.
   * Uses the FieldMappingConfig to map ERP field names to our internal fields.
   */
  protected applyFieldMappings<T extends Record<string, unknown>>(
    raw: Record<string, unknown>,
    mappings: import("../../types/erp").FieldMapping[],
    targetDefaults: Partial<T>
  ): FieldTransformResult<T> {
    const result: Record<string, unknown> = { ...targetDefaults };
    const unmappedFields: string[] = [];
    const transformErrors: FieldTransformResult<T>["transformErrors"] = [];

    for (const mapping of mappings) {
      const rawValue = raw[mapping.erpField];

      if (rawValue === undefined || rawValue === null) {
        if (mapping.required && mapping.defaultValue === undefined) {
          transformErrors.push({
            field: mapping.localField,
            erpField: mapping.erpField,
            error: "Required field is missing and has no default",
            rawValue,
          });
        } else if (mapping.defaultValue !== undefined) {
          result[mapping.localField] = mapping.defaultValue;
        } else {
          unmappedFields.push(mapping.erpField);
        }
        continue;
      }

      try {
        result[mapping.localField] = this.applyTransform(rawValue, mapping.transform ?? "none");
      } catch (error) {
        transformErrors.push({
          field: mapping.localField,
          erpField: mapping.erpField,
          error: error instanceof Error ? error.message : String(error),
          rawValue,
        });
      }
    }

    // Track fields in raw record that aren't in our mapping config
    const mappedErpFields = new Set(mappings.map((m) => m.erpField));
    for (const key of Object.keys(raw)) {
      if (!mappedErpFields.has(key)) {
        unmappedFields.push(key);
      }
    }

    return {
      data: result as T,
      unmappedFields,
      transformErrors,
    };
  }

  /**
   * Apply a transform function to a raw value.
   */
  protected applyTransform(
    value: unknown,
    transform: "none" | "uppercase" | "lowercase" | "trim" | "parse_number" | "parse_date"
  ): unknown {
    switch (transform) {
      case "none":
        return value;
      case "uppercase":
        return typeof value === "string" ? value.toUpperCase() : value;
      case "lowercase":
        return typeof value === "string" ? value.toLowerCase() : value;
      case "trim":
        return typeof value === "string" ? value.trim() : value;
      case "parse_number": {
        if (typeof value === "number") return value;
        const parsed = Number(value);
        if (Number.isNaN(parsed)) {
          throw new Error(`Cannot parse "${String(value)}" as number`);
        }
        return parsed;
      }
      case "parse_date": {
        const date = new Date(value as string | number | Date);
        if (Number.isNaN(date.getTime())) {
          throw new Error(`Cannot parse "${String(value)}" as date`);
        }
        return date.toISOString();
      }
      default:
        return value;
    }
  }

  // ==========================================================================
  // Rate limiting
  // ==========================================================================

  /**
   * Enforce rate limiting before making an API request.
   * Uses a sliding window algorithm with minimum request interval.
   */
  protected async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const state = this.rateLimitState;

    // Enforce minimum interval between requests
    const elapsed = now - state.lastRequestAtMs;
    if (elapsed < state.minRequestIntervalMs) {
      const waitMs = state.minRequestIntervalMs - elapsed;
      await this.sleep(waitMs);
    }

    // Reset window if expired
    if (now - state.windowStartMs >= state.windowDurationMs) {
      state.requestsInWindow = 0;
      state.windowStartMs = now;
    }

    // If we've hit the limit, wait until the window resets
    if (state.requestsInWindow >= state.maxRequestsPerWindow) {
      const waitMs = state.windowDurationMs - (now - state.windowStartMs) + 100; // +100ms buffer
      this.logger.warn(
        { waitMs, requestsInWindow: state.requestsInWindow },
        "Rate limit reached, waiting for window reset"
      );
      await this.sleep(waitMs);
      state.requestsInWindow = 0;
      state.windowStartMs = Date.now();
    }

    state.requestsInWindow++;
    state.lastRequestAtMs = Date.now();
  }

  /**
   * Update rate limit state based on response headers.
   * Most ERP APIs return rate limit info in response headers.
   */
  protected updateRateLimitFromResponse<T>(response: ErpRawResponse<T>): void {
    if (response.rateLimitRemaining !== undefined) {
      // If the API tells us how many requests we have left, adjust our tracking
      if (response.rateLimitRemaining <= 5) {
        this.logger.warn(
          { remaining: response.rateLimitRemaining },
          "ERP API rate limit nearly exhausted"
        );
      }
    }
  }

  // ==========================================================================
  // Authentication lifecycle
  // ==========================================================================

  /**
   * Ensure the connector is authenticated before making requests.
   * Automatically refreshes auth if expired.
   */
  protected async ensureAuthenticated(): Promise<void> {
    if (this.authState.isAuthenticated) {
      // Check if token is about to expire (5-minute buffer)
      if (this.authState.expiresAt) {
        const expiresAt = new Date(this.authState.expiresAt).getTime();
        const bufferMs = 5 * 60 * 1000; // 5 minutes
        if (Date.now() >= expiresAt - bufferMs) {
          this.logger.info("Auth token nearing expiry, refreshing proactively");
          await this.refreshAuth();
        }
      }
      return;
    }

    // Not authenticated — attempt to authenticate
    try {
      await this.connect();
      this.authState.consecutiveFailures = 0;
    } catch (error) {
      this.authState.consecutiveFailures++;
      throw new ErpAuthError(
        this.erpType,
        `Authentication failed (attempt ${this.authState.consecutiveFailures}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ==========================================================================
  // Retry logic
  // ==========================================================================

  /**
   * Calculate exponential backoff delay with jitter.
   * Jitter prevents thundering herd when multiple tenants sync simultaneously.
   */
  protected calculateBackoffDelay(attempt: number): number {
    const baseDelay = this.httpClientConfig.retryDelayMs;
    const maxDelay = 30_000; // 30 second cap
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // Add jitter: random value between 0 and 50% of the delay
    const jitter = Math.random() * exponentialDelay * 0.5;
    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Determine if an error is retryable (rate limit, timeout, network error).
   */
  protected isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("rate limit") ||
      message.includes("429") ||
      message.includes("timeout") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("connection") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("etimedout")
    );
  }

  // ==========================================================================
  // Watermark management
  // ==========================================================================

  /**
   * Compute the next sync watermark from the last batch of records.
   * Looks for common date fields used by ERPs for incremental sync.
   */
  protected computeNextWatermark(
    records: Record<string, unknown>[]
  ): SyncWatermark | undefined {
    if (records.length === 0) return undefined;

    // Find the most recent modification timestamp across all records
    const dateFields = [
      "lastModifiedDate",
      "UpdateDate",
      "lastModifiedDateTime",
      "CHDT",
      "LastUpdateDate",
      "updatedAt",
      "modifiedDate",
    ];

    let latestTimestamp: string | null = null;

    for (const record of records) {
      for (const field of dateFields) {
        const value = record[field];
        if (typeof value === "string" && value) {
          const dateValue = new Date(value);
          if (!Number.isNaN(dateValue.getTime())) {
            if (!latestTimestamp || value > latestTimestamp) {
              latestTimestamp = value;
            }
          }
        }
      }
    }

    if (!latestTimestamp) return undefined;

    return {
      lastSyncTimestamp: latestTimestamp,
      offset: 0,
    };
  }

  // ==========================================================================
  // Utility methods
  // ==========================================================================

  /**
   * Build HTTP client config from the ERP type and environment.
   */
  protected buildHttpClientConfig(): ErpHttpClientConfig {
    return {
      baseUrl: "",
      timeoutMs: ERP_SYNC_CONFIG.TIMEOUT_MS,
      maxRetries: ERP_SYNC_CONFIG.MAX_RETRIES,
      retryDelayMs: ERP_SYNC_CONFIG.RETRY_DELAY_MS,
      rateLimitPerMinute: 200,
    };
  }

  /**
   * Initialize rate limit state from the ERP type configuration.
   */
  protected initializeRateLimitState(): ErpRateLimitState {
    const config = this.getRateLimitConfig();
    return {
      requestsInWindow: 0,
      windowStartMs: Date.now(),
      windowDurationMs: config.windowDurationMs,
      maxRequestsPerWindow: config.requestsPerWindow,
      minRequestIntervalMs: config.minRequestIntervalMs,
      lastRequestAtMs: 0,
    };
  }

  /**
   * Get rate limit configuration for this ERP type.
   */
  protected getRateLimitConfig(): ErpRateLimitConfig {
    // This will be overridden by each connector with specific limits
    return {
      requestsPerWindow: 200,
      windowDurationMs: 60_000,
      minRequestIntervalMs: 50,
      burstAllowance: 10,
      backoffMultiplier: 2,
    };
  }

  /**
   * Get the last successful sync timestamp from sync state.
   */
  protected getLastSuccessfulSyncTime(): string | null {
    const lastSync = this.syncState["lastSuccessfulSyncAt"];
    return typeof lastSync === "string" ? lastSync : null;
  }

  /**
   * Make the actual HTTP request. Subclasses can override this
   * to add custom headers, signing, etc.
   */
  protected async doHttpRequest<T>(options: ErpRequestOptions): Promise<ErpRawResponse<T>> {
    const url = new URL(options.path, this.httpClientConfig.baseUrl);

    if (options.queryParams) {
      for (const [key, value] of Object.entries(options.queryParams)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.httpClientConfig.defaultHeaders,
      ...options.headers,
    };

    const controller = new AbortController();
    const timeout = options.timeoutMs ?? this.httpClientConfig.timeoutMs;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url.toString(), {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json() as T;
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      if (!response.ok) {
        throw new ErpConnectionError(
          this.erpType,
          `HTTP ${response.status}: ${JSON.stringify(data)}`,
          {
            method: options.method,
            path: options.path,
            statusCode: response.status,
            entityContext: options.entityContext,
          }
        );
      }

      return {
        statusCode: response.status,
        headers: responseHeaders,
        data,
        latencyMs: 0, // Set by caller
        rateLimitRemaining: responseHeaders["x-rate-limit-remaining"]
          ? Number(responseHeaders["x-rate-limit-remaining"])
          : undefined,
        rateLimitResetAt: responseHeaders["x-rate-limit-reset"] ?? undefined,
      };
    } catch (error) {
      if (error instanceof ErpConnectionError) throw error;

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ErpConnectionError(
          this.erpType,
          `Request timeout after ${timeout}ms`,
          { method: options.method, path: options.path }
        );
      }

      throw new ErpConnectionError(
        this.erpType,
        `Network error: ${error instanceof Error ? error.message : String(error)}`,
        { method: options.method, path: options.path }
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Sleep utility for rate limiting and backoff.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
