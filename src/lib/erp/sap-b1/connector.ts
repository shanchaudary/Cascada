// Cascada — SAP Business One Connector
// Implements BaseErpConnector for SAP B1 Service Layer REST API.

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
import { loginToSapB1, logoutFromSapB1, validateSapB1AuthConfig, buildSapB1BaseUrl } from "./auth";
import { mapSapB1Ingredient, mapSapB1Formulation, mapSapB1Product, mapSapB1Customer, mapSapB1Supplier } from "./mappings";
import type {
  SapB1Item,
  SapB1ProductTree,
  SapB1BusinessPartner,
  SapB1ListResponse,
  SapB1AuthConfig,
} from "./types";

/**
 * Connector for SAP Business One via Service Layer REST API.
 *
 * SAP B1 is widely used by mid-size food manufacturers. Key characteristics:
 * - Session-based authentication (login → get session ID → send cookie)
 * - OData v3/v4 query syntax for filtering and pagination
 * - Items can be both ingredients and products (distinguished by ItemType)
 * - Product Trees represent BOMs/formulations
 * - Business Partners serve as both customers and vendors (CardType distinguishes)
 * - User-Defined Fields (UDF) for industry-specific data
 */
export class SapB1Connector extends BaseErpConnector {
  readonly erpType: ErpType = "SAP_B1";
  private authConfigTyped: SapB1AuthConfig;
  private sessionId: string | null = null;

  constructor(params: ErpConnectorParams) {
    super(params);

    const rawAuth = params.authConfig as Partial<SapB1AuthConfig>;
    const baseUrl = rawAuth.baseUrl ?? buildSapB1BaseUrl(rawAuth.server ?? "");

    this.authConfigTyped = {
      server: rawAuth.server ?? "",
      companyDb: rawAuth.companyDb ?? "",
      username: rawAuth.username ?? "",
      password: rawAuth.password ?? "",
      baseUrl,
    };

    this.httpClientConfig = {
      ...this.httpClientConfig,
      baseUrl,
    };

    this.logger = createErpSyncLogger("SAP_B1", params.connectionId, "connector");
  }

  async connect(): Promise<void> {
    this.logger.info("Authenticating with SAP B1 Service Layer");
    validateSapB1AuthConfig(this.authConfigTyped);

    try {
      this.sessionId = await loginToSapB1(this.authConfigTyped);
      this.authState = {
        isAuthenticated: true,
        authType: "session",
        lastRefreshedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
      this.logger.info("SAP B1 authentication successful");
    } catch (error) {
      this.authState.consecutiveFailures++;
      throw new ErpAuthError("SAP_B1", `Connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.sessionId) {
      await logoutFromSapB1(this.authConfigTyped.baseUrl, this.sessionId);
      this.sessionId = null;
    }
    this.authState = { isAuthenticated: false, authType: "session", consecutiveFailures: 0 };
  }

  async testConnection(): Promise<ErpConnectionTestResult> {
    const startTime = Date.now();
    try {
      await this.ensureAuthenticated();
      await this.executeRequest({ method: "GET", path: "/Items?$top=1" });
      return {
        success: true,
        message: `Connected to SAP B1 company ${this.authConfigTyped.companyDb}`,
        latencyMs: Date.now() - startTime,
        serverInfo: "SAP Business One Service Layer",
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
    this.logger.info("Refreshing SAP B1 session");
    if (this.sessionId) {
      await logoutFromSapB1(this.authConfigTyped.baseUrl, this.sessionId);
    }
    this.sessionId = await loginToSapB1(this.authConfigTyped);
    this.authState.lastRefreshedAt = new Date().toISOString();
  }

  protected async getApiVersion(): Promise<string | null> {
    return "SAP B1 Service Layer v2";
  }

  // --- Entity fetching ---

  protected async fetchRawIngredients(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    let filter = "ItemType eq 'itItems' and PurchaseItem eq 'tYES'";
    if (pagination.modifiedSince) {
      filter += ` and UpdateDate gt '${pagination.modifiedSince.split("T")[0]}'`;
    }

    const response = await this.executeRequest<SapB1ListResponse<SapB1Item>>({
      method: "GET",
      path: "/Items",
      queryParams: { "$filter": filter, "$top": pagination.limit, "$skip": skip, "$expand": "ItemPrices,PurchasingData" },
    });

    return this.parseODataResponse(response.data, pagination);
  }

  protected async fetchRawFormulations(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    let filter = "TreeType eq 'iProduction'";
    if (pagination.modifiedSince) {
      filter += ` and UpdateDate gt '${pagination.modifiedSince.split("T")[0]}'`;
    }

    const response = await this.executeRequest<SapB1ListResponse<SapB1ProductTree>>({
      method: "GET",
      path: "/ProductTrees",
      queryParams: { "$filter": filter, "$top": pagination.limit, "$skip": skip, "$expand": "ProductTreeLines" },
    });

    return this.parseODataResponse(response.data, pagination);
  }

  protected async fetchRawProducts(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    let filter = "ItemType eq 'itItems' and SalesItem eq 'tYES'";
    if (pagination.modifiedSince) {
      filter += ` and UpdateDate gt '${pagination.modifiedSince.split("T")[0]}'`;
    }

    const response = await this.executeRequest<SapB1ListResponse<SapB1Item>>({
      method: "GET",
      path: "/Items",
      queryParams: { "$filter": filter, "$top": pagination.limit, "$skip": skip },
    });

    return this.parseODataResponse(response.data, pagination);
  }

  protected async fetchRawCustomers(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    let filter = "CardType eq 'cCustomer'";
    if (pagination.modifiedSince) {
      filter += ` and UpdateDate gt '${pagination.modifiedSince.split("T")[0]}'`;
    }

    const response = await this.executeRequest<SapB1ListResponse<SapB1BusinessPartner>>({
      method: "GET",
      path: "/BusinessPartners",
      queryParams: { "$filter": filter, "$top": pagination.limit, "$skip": skip },
    });

    return this.parseODataResponse(response.data, pagination);
  }

  protected async fetchRawSuppliers(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const skip = pagination.offset ?? 0;
    let filter = "CardType eq 'cSupplier'";
    if (pagination.modifiedSince) {
      filter += ` and UpdateDate gt '${pagination.modifiedSince.split("T")[0]}'`;
    }

    const response = await this.executeRequest<SapB1ListResponse<SapB1BusinessPartner>>({
      method: "GET",
      path: "/BusinessPartners",
      queryParams: { "$filter": filter, "$top": pagination.limit, "$skip": skip },
    });

    return this.parseODataResponse(response.data, pagination);
  }

  // --- Entity mapping ---

  protected async mapToIngredient(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpIngredient>> {
    return mapSapB1Ingredient(raw as unknown as SapB1Item);
  }
  protected async mapToFormulation(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpFormulation>> {
    return mapSapB1Formulation(raw as unknown as SapB1ProductTree);
  }
  protected async mapToProduct(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpProduct>> {
    return mapSapB1Product(raw as unknown as SapB1Item);
  }
  protected async mapToCustomer(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpCustomer>> {
    return mapSapB1Customer(raw as unknown as SapB1BusinessPartner);
  }
  protected async mapToSupplier(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpSupplier>> {
    return mapSapB1Supplier(raw as unknown as SapB1BusinessPartner);
  }

  // --- Session cookie injection ---

  protected override async doHttpRequest<T>(options: import("../types").ErpRequestOptions): Promise<import("../types").ErpRawResponse<T>> {
    const enhancedOptions = {
      ...options,
      headers: {
        ...options.headers,
        ...(this.sessionId ? { Cookie: `B1SESSION=${this.sessionId}` } : {}),
      },
    };
    return super.doHttpRequest<T>(enhancedOptions);
  }

  // --- Helpers ---

  private parseODataResponse<T>(
    data: SapB1ListResponse<T>,
    pagination: ErpPaginationParams
  ): ErpPaginatedResponse<Record<string, unknown>> {
    return {
      items: (data.value ?? []).map((item) => item as unknown as Record<string, unknown>),
      totalCount: data["odata.count"] ?? data.value?.length ?? 0,
      hasMore: !!data["odata.nextLink"],
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
