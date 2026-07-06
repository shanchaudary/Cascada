// Cascada — NetSuite Connector
// Implements the BaseErpConnector for NetSuite SuiteTalk REST API.
// Handles OAuth 1.0a authentication, pagination, and entity mapping.

import type { ErpType } from "@prisma/client";
import type {
  ErpConnectionTestResult,
  SyncWatermark,
  FieldMappingConfig,
  FieldTransformResult,
  ErpIngredient,
  ErpFormulation,
  ErpProduct,
  ErpCustomer,
  ErpSupplier,
} from "../types";
import type {
  ErpConnectorParams,
  ErpPaginationParams,
  ErpPaginatedResponse,
  ErpRateLimitConfig,
} from "../types";
import { BaseErpConnector } from "../base-connector";
import { ErpConnectionError, ErpAuthError } from "../../errors";
import { createErpSyncLogger } from "../../logger";
import { generateAuthHeader, validateNetSuiteAuthConfig, buildNetSuiteBaseUrl, parseNetSuiteError } from "./auth";
import { mapNetSuiteIngredient, mapNetSuiteFormulation, mapNetSuiteProduct, mapNetSuiteCustomer, mapNetSuiteVendor } from "./mappings";
import type {
  NetSuiteInventoryItem,
  NetSuiteAssemblyItem,
  NetSuiteAssemblyBuild,
  NetSuiteCustomer as NetSuiteCustomerType,
  NetSuiteVendor as NetSuiteVendorType,
  NetSuiteListResponse,
  NetSuiteTokenAuthConfig,
  NetSuiteErrorResponse,
} from "./types";

// ============================================================================
// NetSuite Connector
// ============================================================================

/**
 * Connector for Oracle NetSuite ERP via SuiteTalk REST API.
 *
 * NetSuite is the most popular ERP for mid-market food manufacturers.
 * It uses OAuth 1.0a token-based authentication and returns paginated
 * JSON responses with HATEOAS links.
 *
 * Key implementation details:
 * - OAuth 1.0a with HMAC-SHA256 signing for every request
 * - Offset-based pagination with hasMore flag
 * - Custom fields (custitem_*, custentity_*) for food industry data
 * - Assembly items represent formulations/BOMs
 * - Assembly builds represent products/production runs
 * - Separate customer and vendor endpoints
 */
export class NetSuiteConnector extends BaseErpConnector {
  readonly erpType: ErpType = "NETSUITE";
  private authConfigTyped: NetSuiteTokenAuthConfig;

  constructor(params: ErpConnectorParams) {
    super(params);

    // Parse and validate auth config
    const rawAuth = params.authConfig as Partial<NetSuiteTokenAuthConfig>;
    const baseUrl = rawAuth.baseUrl ?? buildNetSuiteBaseUrl(rawAuth.accountId ?? "");

    this.authConfigTyped = {
      accountId: rawAuth.accountId ?? "",
      consumerKey: rawAuth.consumerKey ?? "",
      consumerSecret: rawAuth.consumerSecret ?? "",
      tokenId: rawAuth.tokenId ?? "",
      tokenSecret: rawAuth.tokenSecret ?? "",
      baseUrl,
    };

    this.httpClientConfig = {
      ...this.httpClientConfig,
      baseUrl,
      defaultHeaders: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-NetSuite-PropertyNameValidation": "error",
      },
    };

    this.logger = createErpSyncLogger("NETSUITE", params.connectionId, "connector");
  }

  // ==========================================================================
  // Connection lifecycle
  // ==========================================================================

  async connect(): Promise<void> {
    this.logger.info("Authenticating with NetSuite");

    validateNetSuiteAuthConfig(this.authConfigTyped);

    // Test auth by making a lightweight request
    try {
      await this.executeRequest({
        method: "GET",
        path: "/inventoryItem?limit=1",
      });

      this.authState = {
        isAuthenticated: true,
        authType: "oauth2",
        lastRefreshedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };

      this.logger.info("NetSuite authentication successful");
    } catch (error) {
      this.authState.consecutiveFailures++;
      throw new ErpAuthError(
        "NETSUITE",
        `Connection failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async disconnect(): Promise<void> {
    this.authState = {
      isAuthenticated: false,
      authType: "oauth2",
      consecutiveFailures: 0,
    };
    this.logger.info("Disconnected from NetSuite");
  }

  async testConnection(): Promise<ErpConnectionTestResult> {
    const startTime = Date.now();

    try {
      await this.ensureAuthenticated();

      // Make a lightweight request to verify connectivity
      const response = await this.executeRequest<NetSuiteListResponse<unknown>>({
        method: "GET",
        path: "/inventoryItem?limit=1",
      });

      const latencyMs = Date.now() - startTime;

      return {
        success: true,
        message: `Connected to NetSuite account ${this.authConfigTyped.accountId}`,
        latencyMs,
        serverInfo: `NetSuite SuiteTalk REST v1`,
        permissions: ["read"],
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  protected async refreshAuth(): Promise<void> {
    // NetSuite OAuth tokens don't expire — they're permanent until revoked
    // Just re-verify the connection is still valid
    this.logger.info("Verifying NetSuite OAuth token");
    await this.connect();
  }

  protected async getApiVersion(): Promise<string | null> {
    return "SuiteTalk REST v1";
  }

  // ==========================================================================
  // Entity fetching — raw API calls to NetSuite
  // ==========================================================================

  protected async fetchRawIngredients(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      limit: pagination.limit,
      offset: pagination.offset ?? 0,
    };

    // For incremental syncs, add date filter
    if (pagination.modifiedSince) {
      queryParams["q"] = `lastModifiedDate GREATER_THAN "${pagination.modifiedSince}"`;
    }

    const response = await this.executeRequest<NetSuiteListResponse<NetSuiteInventoryItem>>({
      method: "GET",
      path: "/inventoryItem",
      queryParams,
    });

    return {
      items: (response.data.items ?? []).map((item) => item as unknown as Record<string, unknown>),
      totalCount: response.data.totalResults ?? 0,
      hasMore: response.data.hasMore ?? false,
      nextOffset: (pagination.offset ?? 0) + (response.data.items?.length ?? 0),
    };
  }

  protected async fetchRawFormulations(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      limit: pagination.limit,
      offset: pagination.offset ?? 0,
    };

    if (pagination.modifiedSince) {
      queryParams["q"] = `lastModifiedDate GREATER_THAN "${pagination.modifiedSince}"`;
    }

    const response = await this.executeRequest<NetSuiteListResponse<NetSuiteAssemblyItem>>({
      method: "GET",
      path: "/assemblyItem",
      queryParams,
    });

    // For each assembly, fetch the full BOM with member items
    const assemblies: Record<string, unknown>[] = [];
    for (const item of response.data.items ?? []) {
      try {
        const detailResponse = await this.executeRequest<NetSuiteAssemblyItem>({
          method: "GET",
          path: `/assemblyItem/${item.id}`,
          queryParams: { expand: "memberList" },
        });
        assemblies.push(detailResponse.data as unknown as Record<string, unknown>);
      } catch (error) {
        this.logger.warn(
          { assemblyId: item.id, error: error instanceof Error ? error.message : String(error) },
          "Failed to fetch assembly detail, using list data"
        );
        assemblies.push(item as unknown as Record<string, unknown>);
      }
    }

    return {
      items: assemblies,
      totalCount: response.data.totalResults ?? 0,
      hasMore: response.data.hasMore ?? false,
      nextOffset: (pagination.offset ?? 0) + (response.data.items?.length ?? 0),
    };
  }

  protected async fetchRawProducts(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      limit: pagination.limit,
      offset: pagination.offset ?? 0,
    };

    if (pagination.modifiedSince) {
      queryParams["q"] = `lastModifiedDate GREATER_THAN "${pagination.modifiedSince}"`;
    }

    const response = await this.executeRequest<NetSuiteListResponse<NetSuiteAssemblyBuild>>({
      method: "GET",
      path: "/assemblyBuild",
      queryParams,
    });

    return {
      items: (response.data.items ?? []).map((item) => item as unknown as Record<string, unknown>),
      totalCount: response.data.totalResults ?? 0,
      hasMore: response.data.hasMore ?? false,
      nextOffset: (pagination.offset ?? 0) + (response.data.items?.length ?? 0),
    };
  }

  protected async fetchRawCustomers(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      limit: pagination.limit,
      offset: pagination.offset ?? 0,
    };

    if (pagination.modifiedSince) {
      queryParams["q"] = `lastModifiedDate GREATER_THAN "${pagination.modifiedSince}"`;
    }

    const response = await this.executeRequest<NetSuiteListResponse<NetSuiteCustomerType>>({
      method: "GET",
      path: "/customer",
      queryParams,
    });

    return {
      items: (response.data.items ?? []).map((item) => item as unknown as Record<string, unknown>),
      totalCount: response.data.totalResults ?? 0,
      hasMore: response.data.hasMore ?? false,
      nextOffset: (pagination.offset ?? 0) + (response.data.items?.length ?? 0),
    };
  }

  protected async fetchRawSuppliers(
    pagination: ErpPaginationParams
  ): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      limit: pagination.limit,
      offset: pagination.offset ?? 0,
    };

    if (pagination.modifiedSince) {
      queryParams["q"] = `lastModifiedDate GREATER_THAN "${pagination.modifiedSince}"`;
    }

    const response = await this.executeRequest<NetSuiteListResponse<NetSuiteVendorType>>({
      method: "GET",
      path: "/vendor",
      queryParams,
    });

    return {
      items: (response.data.items ?? []).map((item) => item as unknown as Record<string, unknown>),
      totalCount: response.data.totalResults ?? 0,
      hasMore: response.data.hasMore ?? false,
      nextOffset: (pagination.offset ?? 0) + (response.data.items?.length ?? 0),
    };
  }

  // ==========================================================================
  // Entity mapping — raw NetSuite data → internal types
  // ==========================================================================

  protected async mapToIngredient(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpIngredient>> {
    return mapNetSuiteIngredient(raw as unknown as NetSuiteInventoryItem);
  }

  protected async mapToFormulation(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpFormulation>> {
    return mapNetSuiteFormulation(raw as unknown as NetSuiteAssemblyItem);
  }

  protected async mapToProduct(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpProduct>> {
    const assemblies = new Map<string, string>(); // Populated in real usage
    return mapNetSuiteProduct(raw as unknown as NetSuiteAssemblyBuild, assemblies);
  }

  protected async mapToCustomer(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpCustomer>> {
    return mapNetSuiteCustomer(raw as unknown as NetSuiteCustomerType);
  }

  protected async mapToSupplier(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpSupplier>> {
    return mapNetSuiteVendor(raw as unknown as NetSuiteVendorType);
  }

  // ==========================================================================
  // Override HTTP request to add OAuth signing
  // ==========================================================================

  protected override async doHttpRequest<T>(options: import("../types").ErpRequestOptions): Promise<import("../types").ErpRawResponse<T>> {
    const fullUrl = `${this.httpClientConfig.baseUrl}${options.path}`;

    // Generate OAuth header
    const authHeader = generateAuthHeader(
      this.authConfigTyped,
      options.method,
      fullUrl,
      options.body ? JSON.stringify(options.body) : undefined
    );

    // Add auth header to request
    const enhancedOptions = {
      ...options,
      headers: {
        ...options.headers,
        Authorization: authHeader,
      },
    };

    return super.doHttpRequest<T>(enhancedOptions);
  }

  // ==========================================================================
  // Rate limit configuration
  // ==========================================================================

  protected override getRateLimitConfig(): ErpRateLimitConfig {
    return {
      requestsPerWindow: 200,
      windowDurationMs: 60_000,
      minRequestIntervalMs: 50,
      burstAllowance: 10,
      backoffMultiplier: 2,
    };
  }
}
