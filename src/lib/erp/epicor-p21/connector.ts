// Cascada — Epicor Prophet 21 Connector
// Implements BaseErpConnector for Epicor P21 REST API.

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
import { createEpicorP21Session, deleteEpicorP21Session, validateEpicorP21AuthConfig, buildEpicorP21BaseUrl } from "./auth";
import { mapEpicorP21Ingredient, mapEpicorP21Formulation, mapEpicorP21Product, mapEpicorP21Customer, mapEpicorP21Supplier } from "./mappings";
import type {
  EpicorP21Item,
  EpicorP21BOM,
  EpicorP21Customer as EpicorP21CustomerType,
  EpicorP21Vendor as EpicorP21VendorType,
  EpicorP21ListResponse,
  EpicorP21AuthConfig,
} from "./types";

/**
 * Connector for Epicor Prophet 21 via REST API.
 *
 * Epicor P21 is used by distributors and manufacturers in the process industries.
 * Key characteristics:
 * - Session-based authentication (create session → get session ID → send in header)
 * - REST API with standard CRUD endpoints
 * - Pagination via $top/$skip (OData-style)
 * - Inventory items serve as both ingredients and products
 * - BOMs represent formulations
 * - Separate Customer and Vendor endpoints
 * - UDF (User Defined Fields) for custom data
 * - Company-scoped data access
 */
export class EpicorP21Connector extends BaseErpConnector {
  readonly erpType: ErpType = "EPICOR_P21";
  private authConfigTyped: EpicorP21AuthConfig;
  private sessionId: string | null = null;

  constructor(params: ErpConnectorParams) {
    super(params);

    const rawAuth = params.authConfig as Partial<EpicorP21AuthConfig>;
    const baseUrl = rawAuth.baseUrl ?? buildEpicorP21BaseUrl(rawAuth.server ?? "");

    this.authConfigTyped = {
      server: rawAuth.server ?? "",
      company: rawAuth.company ?? "",
      username: rawAuth.username ?? "",
      password: rawAuth.password ?? "",
      baseUrl,
    };

    this.httpClientConfig = {
      ...this.httpClientConfig,
      baseUrl,
    };

    this.logger = createErpSyncLogger("EPICOR_P21", params.connectionId, "connector");
  }

  async connect(): Promise<void> {
    this.logger.info("Authenticating with Epicor P21");
    validateEpicorP21AuthConfig(this.authConfigTyped);

    try {
      this.sessionId = await createEpicorP21Session(this.authConfigTyped);
      this.authState = {
        isAuthenticated: true,
        authType: "session",
        lastRefreshedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
      this.logger.info("Epicor P21 authentication successful");
    } catch (error) {
      this.authState.consecutiveFailures++;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.sessionId) {
      await deleteEpicorP21Session(this.authConfigTyped.baseUrl, this.sessionId);
      this.sessionId = null;
    }
    this.authState = { isAuthenticated: false, authType: "session", consecutiveFailures: 0 };
  }

  async testConnection(): Promise<ErpConnectionTestResult> {
    const startTime = Date.now();
    try {
      await this.ensureAuthenticated();
      await this.executeRequest({ method: "GET", path: "/api/v1/ics/invitems?$top=1" });
      return {
        success: true,
        message: `Connected to Epicor P21 (${this.authConfigTyped.company})`,
        latencyMs: Date.now() - startTime,
        serverInfo: "Epicor Prophet 21 REST API",
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
    this.logger.info("Refreshing Epicor P21 session");
    if (this.sessionId) {
      await deleteEpicorP21Session(this.authConfigTyped.baseUrl, this.sessionId);
    }
    this.sessionId = await createEpicorP21Session(this.authConfigTyped);
    this.authState.lastRefreshedAt = new Date().toISOString();
  }

  protected async getApiVersion(): Promise<string | null> {
    return "Epicor P21 REST API v1";
  }

  // --- Entity fetching ---

  protected async fetchRawIngredients(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
    };

    if (pagination.modifiedSince) {
      queryParams["$filter"] = `last_update_date gt '${pagination.modifiedSince}'`;
    }

    const response = await this.executeRequest<EpicorP21ListResponse<EpicorP21Item>>({
      method: "GET",
      path: "/api/v1/ics/invitems",
      queryParams,
    });

    return this.parseP21Response(response.data, pagination);
  }

  protected async fetchRawFormulations(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
      "$expand": "components",
    };

    if (pagination.modifiedSince) {
      queryParams["$filter"] = `last_update_date gt '${pagination.modifiedSince}'`;
    }

    const response = await this.executeRequest<EpicorP21ListResponse<EpicorP21BOM>>({
      method: "GET",
      path: "/api/v1/engr/boms",
      queryParams,
    });

    return this.parseP21Response(response.data, pagination);
  }

  protected async fetchRawProducts(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
    };

    // Products are inventory items that are not raw materials
    let filter = "product_group ne 'RAW'";
    if (pagination.modifiedSince) {
      filter += ` and last_update_date gt '${pagination.modifiedSince}'`;
    }
    queryParams["$filter"] = filter;

    const response = await this.executeRequest<EpicorP21ListResponse<EpicorP21Item>>({
      method: "GET",
      path: "/api/v1/ics/invitems",
      queryParams,
    });

    return this.parseP21Response(response.data, pagination);
  }

  protected async fetchRawCustomers(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
    };

    if (pagination.modifiedSince) {
      queryParams["$filter"] = `last_update_date gt '${pagination.modifiedSince}'`;
    }

    const response = await this.executeRequest<EpicorP21ListResponse<EpicorP21CustomerType>>({
      method: "GET",
      path: "/api/v1/arp/customers",
      queryParams,
    });

    return this.parseP21Response(response.data, pagination);
  }

  protected async fetchRawSuppliers(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    const queryParams: Record<string, string | number | boolean> = {
      "$top": pagination.limit,
      "$skip": skip,
    };

    if (pagination.modifiedSince) {
      queryParams["$filter"] = `last_update_date gt '${pagination.modifiedSince}'`;
    }

    const response = await this.executeRequest<EpicorP21ListResponse<EpicorP21VendorType>>({
      method: "GET",
      path: "/api/v1/apm/vendors",
      queryParams,
    });

    return this.parseP21Response(response.data, pagination);
  }

  // --- Entity mapping ---

  protected async mapToIngredient(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpIngredient>> {
    return mapEpicorP21Ingredient(raw as unknown as EpicorP21Item);
  }
  protected async mapToFormulation(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpFormulation>> {
    return mapEpicorP21Formulation(raw as unknown as EpicorP21BOM);
  }
  protected async mapToProduct(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpProduct>> {
    return mapEpicorP21Product(raw as unknown as EpicorP21Item);
  }
  protected async mapToCustomer(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpCustomer>> {
    return mapEpicorP21Customer(raw as unknown as EpicorP21CustomerType);
  }
  protected async mapToSupplier(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpSupplier>> {
    return mapEpicorP21Supplier(raw as unknown as EpicorP21VendorType);
  }

  // --- Session header injection ---

  protected override async doHttpRequest<T>(options: import("../types").ErpRequestOptions): Promise<import("../types").ErpRawResponse<T>> {
    const enhancedOptions = {
      ...options,
      headers: {
        ...options.headers,
        ...(this.sessionId ? { "X-P21-Session-Id": this.sessionId } : {}),
      },
    };
    return super.doHttpRequest<T>(enhancedOptions);
  }

  // --- Helpers ---

  private parseP21Response<T>(data: EpicorP21ListResponse<T>, pagination: ErpPaginationParams): ErpPaginatedResponse<Record<string, unknown>> {
    return {
      items: (data.Items ?? []).map((item) => item as unknown as Record<string, unknown>),
      totalCount: data.TotalCount ?? data.Items?.length ?? 0,
      hasMore: data.HasMore ?? !!data.NextPageLink,
      nextOffset: (pagination.offset ?? 0) + (data.Items?.length ?? 0),
    };
  }

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
