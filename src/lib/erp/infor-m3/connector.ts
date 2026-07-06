// Cascada — Infor CloudSuite M3 Connector
// Implements BaseErpConnector for Infor M3 MI API via ION API Gateway.

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
import { acquireInforM3Token, validateInforM3AuthConfig, buildInforM3BaseUrl } from "./auth";
import { mapInforM3Ingredient, mapInforM3Formulation, mapInforM3Product, mapInforM3Customer, mapInforM3Supplier } from "./mappings";
import type {
  InforM3Item,
  InforM3ProductStructure,
  InforM3Customer as InforM3CustomerType,
  InforM3Supplier as InforM3SupplierType,
  InforM3ListResponse,
  InforM3AuthConfig,
} from "./types";

/**
 * Connector for Infor CloudSuite M3 via ION API Gateway.
 *
 * Infor M3 is used by large food manufacturers (especially in process industries).
 * Key characteristics:
 * - OAuth2 client credentials via Infor ION API Gateway
 * - MI (M3 Interface) API with program-specific endpoints
 * - Short field names (6-char) from M3's IBM i heritage
 * - MMS002MI for items (ingredients and products)
 * - PDS001MI for product structures (formulations/BOMs)
 * - CRS610MI for customers, CRS620MI for suppliers
 * - Pagination via record count and offset
 * - Change date (CHDT) used for incremental sync watermarks
 */
export class InforM3Connector extends BaseErpConnector {
  readonly erpType: ErpType = "INFOR_M3";
  private authConfigTyped: InforM3AuthConfig;
  private accessToken: string | null = null;

  constructor(params: ErpConnectorParams) {
    super(params);

    const rawAuth = params.authConfig as Partial<InforM3AuthConfig>;
    const baseUrl = rawAuth.baseUrl ?? buildInforM3BaseUrl(
      rawAuth.tenantId ?? "",
      rawAuth.organization ?? ""
    );

    this.authConfigTyped = {
      tenantId: rawAuth.tenantId ?? "",
      clientId: rawAuth.clientId ?? "",
      clientSecret: rawAuth.clientSecret ?? "",
      organization: rawAuth.organization ?? "",
      baseUrl,
    };

    this.httpClientConfig = {
      ...this.httpClientConfig,
      baseUrl,
      timeoutMs: 300_000, // 5 minutes — M3 can be slow
    };

    this.logger = createErpSyncLogger("INFOR_M3", params.connectionId, "connector");
  }

  async connect(): Promise<void> {
    this.logger.info("Authenticating with Infor M3");
    validateInforM3AuthConfig(this.authConfigTyped);

    try {
      this.accessToken = await acquireInforM3Token(this.authConfigTyped);
      this.authState = {
        isAuthenticated: true,
        authType: "oauth2",
        expiresAt: new Date(Date.now() + 3500_000).toISOString(),
        lastRefreshedAt: new Date().toISOString(),
        consecutiveFailures: 0,
      };
      this.logger.info("Infor M3 authentication successful");
    } catch (error) {
      this.authState.consecutiveFailures++;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.accessToken = null;
    this.authState = { isAuthenticated: false, authType: "oauth2", consecutiveFailures: 0 };
  }

  async testConnection(): Promise<ErpConnectionTestResult> {
    const startTime = Date.now();
    try {
      await this.ensureAuthenticated();
      await this.executeRequest({ method: "GET", path: "/MMS002MI/GetMitmas?maxRecords=1" });
      return {
        success: true,
        message: `Connected to Infor M3 (${this.authConfigTyped.organization})`,
        latencyMs: Date.now() - startTime,
        serverInfo: "Infor CloudSuite M3 MI API",
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
    this.logger.info("Refreshing Infor M3 OAuth2 token");
    this.accessToken = await acquireInforM3Token(this.authConfigTyped);
    this.authState.expiresAt = new Date(Date.now() + 3500_000).toISOString();
    this.authState.lastRefreshedAt = new Date().toISOString();
  }

  protected async getApiVersion(): Promise<string | null> {
    return "Infor M3 MI API v1";
  }

  // --- Entity fetching ---

  protected async fetchRawIngredients(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      maxRecords: pagination.limit,
      returnCols: "MMITNO,MMITDS,MMFUDS,MMITTY,MMITCL,MMUNMS,MMPUPR,MMSAPR,MMSTQT,MMCFI1,CHDT,LMDT",
    };

    if (pagination.offset) queryParams["skipRecords"] = pagination.offset;
    if (pagination.modifiedSince) queryParams["CHDT"] = `>${pagination.modifiedSince.split("T")[0]}`;

    const response = await this.executeRequest<InforM3ListResponse<InforM3Item>>({
      method: "GET",
      path: "/MMS002MI/GetMitmas",
      queryParams,
    });

    return this.parseM3Response(response.data, pagination);
  }

  protected async fetchRawFormulations(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      maxRecords: pagination.limit,
    };

    if (pagination.offset) queryParams["skipRecords"] = pagination.offset;

    const response = await this.executeRequest<InforM3ListResponse<InforM3ProductStructure>>({
      method: "GET",
      path: "/PDS001MI/GetMthdHead",
      queryParams,
    });

    // For each product structure, fetch its components
    const enrichedResults: Record<string, unknown>[] = [];
    for (const ps of response.data.results ?? []) {
      try {
        const compResponse = await this.executeRequest<InforM3ListResponse<unknown>>({
          method: "GET",
          path: `/PDS001MI/GetMthdLine`,
          queryParams: { method: ps.PDMTPN },
        });
        (ps as unknown as Record<string, unknown>)["components"] = compResponse.data.results;
      } catch {
        // Component fetch failure is non-fatal
      }
      enrichedResults.push(ps as unknown as Record<string, unknown>);
    }

    return {
      items: enrichedResults,
      totalCount: response.data.metadata?.totalCount ?? enrichedResults.length,
      hasMore: response.data.metadata?.hasMore ?? false,
      nextOffset: (pagination.offset ?? 0) + enrichedResults.length,
    };
  }

  protected async fetchRawProducts(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    // In M3, products are also in MMS002MI — filter for finished goods
    const queryParams: Record<string, string | number | boolean> = {
      maxRecords: pagination.limit,
      returnCols: "MMITNO,MMITDS,MMFUDS,MMITTY,MMUNMS,MMSAPR,MMSTQT,MMCFI1,CHDT,LMDT",
    };

    if (pagination.offset) queryParams["skipRecords"] = pagination.offset;
    if (pagination.modifiedSince) queryParams["CHDT"] = `>${pagination.modifiedSince.split("T")[0]}`;

    const response = await this.executeRequest<InforM3ListResponse<InforM3Item>>({
      method: "GET",
      path: "/MMS002MI/GetMitmas",
      queryParams,
    });

    return this.parseM3Response(response.data, pagination);
  }

  protected async fetchRawCustomers(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      maxRecords: pagination.limit,
    };

    if (pagination.offset) queryParams["skipRecords"] = pagination.offset;
    if (pagination.modifiedSince) queryParams["CHDT"] = `>${pagination.modifiedSince.split("T")[0]}`;

    const response = await this.executeRequest<InforM3ListResponse<InforM3CustomerType>>({
      method: "GET",
      path: "/CRS610MI/GetCustHead",
      queryParams,
    });

    return this.parseM3Response(response.data, pagination);
  }

  protected async fetchRawSuppliers(pagination: ErpPaginationParams): Promise<ErpPaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {
      maxRecords: pagination.limit,
    };

    if (pagination.offset) queryParams["skipRecords"] = pagination.offset;
    if (pagination.modifiedSince) queryParams["CHDT"] = `>${pagination.modifiedSince.split("T")[0]}`;

    const response = await this.executeRequest<InforM3ListResponse<InforM3SupplierType>>({
      method: "GET",
      path: "/CRS620MI/GetSupHead",
      queryParams,
    });

    return this.parseM3Response(response.data, pagination);
  }

  // --- Entity mapping ---

  protected async mapToIngredient(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpIngredient>> {
    return mapInforM3Ingredient(raw as unknown as InforM3Item);
  }
  protected async mapToFormulation(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpFormulation>> {
    return mapInforM3Formulation(raw as unknown as InforM3ProductStructure);
  }
  protected async mapToProduct(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpProduct>> {
    return mapInforM3Product(raw as unknown as InforM3Item);
  }
  protected async mapToCustomer(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpCustomer>> {
    return mapInforM3Customer(raw as unknown as InforM3CustomerType);
  }
  protected async mapToSupplier(raw: Record<string, unknown>): Promise<FieldTransformResult<ErpSupplier>> {
    return mapInforM3Supplier(raw as unknown as InforM3SupplierType);
  }

  // --- Bearer token injection ---

  protected override async doHttpRequest<T>(options: import("../types").ErpRequestOptions): Promise<import("../types").ErpRawResponse<T>> {
    const enhancedOptions = {
      ...options,
      headers: {
        ...options.headers,
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        "X-Infor-Organization": this.authConfigTyped.organization,
      },
    };
    return super.doHttpRequest<T>(enhancedOptions);
  }

  // --- Helpers ---

  private parseM3Response<T>(
    data: InforM3ListResponse<T>,
    pagination: ErpPaginationParams
  ): ErpPaginatedResponse<Record<string, unknown>> {
    return {
      items: (data.results ?? []).map((item) => item as unknown as Record<string, unknown>),
      totalCount: data.metadata?.totalCount ?? data.results?.length ?? 0,
      hasMore: data.metadata?.hasMore ?? false,
      nextOffset: (pagination.offset ?? 0) + (data.results?.length ?? 0),
    };
  }

  protected override getRateLimitConfig(): ErpRateLimitConfig {
    return {
      requestsPerWindow: 120,
      windowDurationMs: 60_000,
      minRequestIntervalMs: 100,
      burstAllowance: 5,
      backoffMultiplier: 2,
    };
  }
}
