// Cascada — Dynamics 365 Business Central Connector
// Implements BaseErpConnector for D365 BC API via OAuth2.

import type { ErpType } from "@prisma/client";
import type {
  ErpConnectionTestResult,
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
import { ErpAuthError } from "../../errors";
import { createErpSyncLogger } from "../../logger";
import { acquireD365Token, validateD365AuthConfig, buildD365BaseUrl } from "./auth";
import { mapD365Ingredient, mapD365Formulation, mapD365Product, mapD365Customer, mapD365Supplier } from "./mappings";
import type {
  D365Item,
  D365ProductionBOM,
  D365Customer as D365CustomerType,
  D365Vendor as D365VendorType,
  D365ListResponse,
  D365AuthConfig,
} from "./types";

/**
 * Connector for Microsoft Dynamics 365 Business Central via API v2.0.
 *
 * D365 BC is popular with food manufacturers using the Microsoft ecosystem.
 * Key characteristics:
 * - OAuth2 client credentials flow via Microsoft Entra ID
 * - OData v4 query syntax with $filter, $top, $skip, $expand, $count
 * - Company-scoped API endpoints (each company gets a separate endpoint)
 * - Items serve as both ingredients and products
 * - Production BOMs represent formulations
 * - Separate Customer and Vendor endpoints
 * - API v2.0 with standard business entity endpoints
 */
export class Dynamics365Connector extends BaseErpConnector {
  readonly erpType: ErpType = "DYNAMICS_365_BC";
  private authConfigTyped: D365AuthConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(params: ErpConnectorParams) {
    super(params);

    const rawAuth = params.authConfig as Partial<D365AuthConfig>;
    const baseUrl = rawAuth.baseUrl ?? buildD365BaseUrl(
      rawAuth.environment ?? "",
      rawAuth.companyId ?? ""
    );

    this.authConfigTyped = {
      tenantId: rawAuth.tenantId ?? "",
      clientId: rawAuth.clientId ?? "",
      clientSecret: rawAuth.clientSecret ?? "",
      environment: rawAuth.environment ?? "",
      companyId: rawAuth.companyId ?? "",
      baseUrl,
    };

    this.httpClientConfig = {
      ...this.httpClientConfig,
      baseUrl,
    };

    this.logger = createErpSyncLogger("DYNAMICS_365_BC", params.connectionId, "connector");
  }

  async connect(): Promise<void> {
    this.logger.info("Authenticating with D365 BC");
    validateD365AuthConfig(this.authConfigTyped);

    try {
      this.accessToken = await acquireD365Token(this.authConfigTyped);
      this.tokenExpiresAt = Date.now() + 3500_000; // ~58 min (tokens last 60 min)
      this.authState = {
        isAuthenticated: true,
        authType: "oauth2",
        expiresAt: new Date(this.tokenExpiresAt).toISOString(),
        lastRefreshedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
      this.logger.info("D365 BC authentication successful");
    } catch (error) {
      this.authState.consecutiveFailures++;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.authState = { isAuthenticated: false, authType: "oauth2", consecutiveFailures: 0 };
  }

  async testConnection(): Promise<ErpConnectionTestResult> {
    const startTime = Date.now();
    try {
      await this.ensureAuthenticated();
      await this.executeRequest({ method: "GET", path: "/items?$top=1" });
      return {
        success: true,
        message: `Connected to D365 BC (${this.authConfigTyped.environment})`,
        latencyMs: Date.now() - startTime,
        serverInfo: "Microsoft Dynamics 365 Business Central API v2.0",
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
    this.logger.info("Refreshing D365 BC OAuth2 token");
    this.accessToken = await acquireD365Token(this.authConfigTyped);
    this.tokenExpiresAt = Date.now() + 3500_000;
    this.authState.expiresAt = new Date(this.tokenExpiresAt).toISOString();
    this.authState.lastRefreshedAt = new Date().toISOString();
  }

  protected async getApiVersion(): Promise<string | null> {
    return "D365 BC API v2.0";
  }

  // --- Entity fetching ---

  protected async fetchRawIngredients(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
      "$count": true,
    };

    let filter = "type eq 'Inventory'";
    if (pagination.modifiedSince) {
      filter += ` and lastModifiedDateTime gt ${pagination.modifiedSince}`;
    }
    queryParams["$filter"] = filter;

    const response = await this.executeRequest<D365ListResponse<D365Item>>({
      method: "GET",
      path: "/items",
      queryParams,
    });

    return this.parseODataResponse(response.data, pagination);
  }

  protected async fetchRawFormulations(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
      "$count": true,
      "$expand": "productionBOMLines",
    };

    if (pagination.modifiedSince) {
      queryParams["$filter"] = `lastModifiedDateTime gt ${pagination.modifiedSince}`;
    }

    const response = await this.executeRequest<D365ListResponse<D365ProductionBOM>>({
      method: "GET",
      path: "/productionBOMs",
      queryParams,
    });

    return this.parseODataResponse(response.data, pagination);
  }

  protected async fetchRawProducts(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
      "$count": true,
    };

    let filter = "type eq 'Inventory' and assemblyBOM eq true";
    if (pagination.modifiedSince) {
      filter += ` and lastModifiedDateTime gt ${pagination.modifiedSince}`;
    }
    queryParams["$filter"] = filter;

    const response = await this.executeRequest<D365ListResponse<D365Item>>({
      method: "GET",
      path: "/items",
      queryParams,
    });

    return this.parseODataResponse(response.data, pagination);
  }

  protected async fetchRawCustomers(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
      "$count": true,
    };

    if (pagination.modifiedSince) {
      queryParams["$filter"] = `lastModifiedDateTime gt ${pagination.modifiedSince}`;
    }

    const response = await this.executeRequest<D365ListResponse<D365CustomerType>>({
      method: "GET",
      path: "/customers",
      queryParams,
    });

    return this.parseODataResponse(response.data, pagination);
  }

  protected async fetchRawSuppliers(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
      "$count": true,
    };

    if (pagination.modifiedSince) {
      queryParams["$filter"] = `lastModifiedDateTime gt ${pagination.modifiedSince}`;
    }

    const response = await this.executeRequest<D365ListResponse<D365VendorType>>({
      method: "GET",
      path: "/vendors",
      queryParams,
    });

    return this.parseODataResponse(response.data, pagination);
  }

  // --- Entity mapping ---

  protected async mapToIngredient(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpIngredient>> {
    return mapD365Ingredient(raw as unknown as D365Item);
  }
  protected async mapToFormulation(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpFormulation>> {
    return mapD365Formulation(raw as unknown as D365ProductionBOM);
  }
  protected async mapToProduct(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpProduct>> {
    return mapD365Product(raw as unknown as D365Item);
  }
  protected async mapToCustomer(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpCustomer>> {
    return mapD365Customer(raw as unknown as D365CustomerType);
  }
  protected async mapToSupplier(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpSupplier>> {
    return mapD365Supplier(raw as unknown as D365VendorType);
  }

  // --- Bearer token injection ---

  protected override async doHttpRequest<T>(options: import("../types").ErpRequestOptions): Promise<import("../types").ErpRawResponse<T>> {
    const enhancedOptions = {
      ...options,
      headers: {
        ...options.headers,
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
    };
    return super.doHttpRequest<T>(enhancedOptions);
  }

  // --- Helpers ---

  private parseODataResponse<T>(data: D365ListResponse<T>, pagination: ErpPaginationParams): ErpPaginatedResponse<Record<string, unknown>> {
    return {
      items: (data.value ?? []).map((item) => item as unknown as Record<string, unknown>),
      totalCount: data["@odata.count"] ?? data.value?.length ?? 0,
      hasMore: !!data["@odata.nextLink"],
      nextOffset: (pagination.offset ?? 0) + (data.value?.length ?? 0),
    };
  }

  protected override getRateLimitConfig(): ErpRateLimitConfig {
    return {
      requestsPerWindow: 300,
      windowDurationMs: 60_000,
      minRequestIntervalMs: 33,
      burstAllowance: 15,
      backoffMultiplier: 2,
    };
  }
}
