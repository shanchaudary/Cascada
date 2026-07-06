// Cascada — USDA FoodData Central Pipeline Client
// Concrete implementation of the USDA FoodData Central data ingestion pipeline.
// Fetches food product data, nutrient information, and ingredient details
// to support substance matching and cascade impact analysis.
// API: https://api.nal.usda.gov/fdc/v1/
//
// Pipeline flow:
// 1. Search for food items containing specific additives/ingredients
// 2. Fetch detailed food item data
// 3. Transform into TransformedRegulatorySource (as reference data)
// 4. Deduplicate against existing records
// 5. Persist new/updated records
//
// Rate limit: 3600 requests/hour.

import { BasePipelineClient } from "../base-client";
import { PIPELINE_CONFIG } from "@/lib/constants";
import { PipelineError } from "@/lib/errors";
import { createPipelineLogger } from "@/lib/logger";
import type {
  PipelineSourceConfig,
  PipelineFetchResult,
  PipelineRequestOptions,
  TransformedRegulatorySource,
} from "../types";
import type {
  UsdaSearchResponse,
  UsdaFoodItem,
  UsdaSearchParams,
  UsdaDataType,
} from "./types";
import { USDA_INGREDIENT_QUERIES } from "./types";
import { transformUsdaFoodItem } from "./transforms";

// ============================================================================
// Pipeline configuration
// ============================================================================
const USDA_CONFIG: PipelineSourceConfig = {
  type: "usda",
  name: "USDA FoodData Central",
  baseUrl: PIPELINE_CONFIG.USDA.baseUrl,
  apiKeyEnvVar: "USDA_API_KEY",
  apiKeyRequired: true,
  rateLimit: {
    maxRequests: PIPELINE_CONFIG.USDA.rateLimitPerHour,
    intervalMs: 3600000, // 1 hour
  },
  pollIntervalMinutes: PIPELINE_CONFIG.USDA.pollIntervalMinutes,
  maxRecordsPerRun: 1000,
  defaultFilters: {},
  requestTimeoutMs: 30000,
};

// ============================================================================
// USDA Pipeline Client
// ============================================================================
export class UsdaClient extends BasePipelineClient<
  UsdaFoodItem,
  TransformedRegulatorySource
> {
  readonly pipelineType = "usda" as const;
  readonly config = USDA_CONFIG;

  // Search queries to execute
  private searchQueries: string[] = [];
  private currentQueryIndex = 0;
  private currentPage = 1;

  constructor() {
    super({
      maxRetries: PIPELINE_CONFIG.USDA.maxRetries,
      baseDelayMs: PIPELINE_CONFIG.USDA.retryDelayMs,
    });
  }

  // ==========================================================================
  // Abstract method implementations
  // ==========================================================================

  protected buildFetchRequest(
    cursor: string | null,
    limit: number
  ): PipelineRequestOptions {
    if (!cursor) {
      this.searchQueries = [...USDA_INGREDIENT_QUERIES];
      this.currentQueryIndex = 0;
      this.currentPage = 1;
    } else {
      const parts = cursor.split("|");
      this.currentQueryIndex = parseInt(parts[0] ?? "0", 10);
      this.currentPage = parseInt(parts[1] ?? "1", 10);
    }

    const query = this.searchQueries[this.currentQueryIndex];
    if (!query) {
      return { path: "foods/search", params: { pageSize: 0 } };
    }

    return {
      path: "foods/search",
      params: {
        query,
        dataType: "Branded,Foundation,SR Legacy",
        pageNumber: this.currentPage,
        pageSize: Math.min(limit, 200),
        sortBy: "dataType.keyword",
        sortOrder: "asc",
        requireAllWords: false,
      },
    };
  }

  protected parseFetchResponse(
    responseData: unknown,
    _statusCode: number,
    _headers: Record<string, string>
  ): PipelineFetchResult<UsdaFoodItem> {
    const apiResponse = responseData as UsdaSearchResponse;

    const results = apiResponse.foods ?? [];
    const totalPages = apiResponse.totalPages ?? 1;

    // Check if current query has more pages
    const isQueryComplete = this.currentPage >= totalPages;

    let nextCursor: string | null;
    if (isQueryComplete) {
      const nextIndex = this.currentQueryIndex + 1;
      if (nextIndex >= this.searchQueries.length) {
        nextCursor = null;
      } else {
        nextCursor = `${nextIndex}|1`;
      }
    } else {
      nextCursor = `${this.currentQueryIndex}|${this.currentPage + 1}`;
    }

    const isLastPage =
      isQueryComplete &&
      this.currentQueryIndex >= this.searchQueries.length - 1;

    return {
      records: results,
      totalAvailable: apiResponse.totalHits ?? 0,
      nextCursor,
      isLastPage,
      metadata: {
        queryIndex: this.currentQueryIndex,
        page: this.currentPage,
        totalPages,
      },
    };
  }

  transform(raw: UsdaFoodItem): TransformedRegulatorySource {
    return transformUsdaFoodItem(raw);
  }

  // ==========================================================================
  // USDA-specific methods
  // ==========================================================================

  /**
   * Search for food items by query.
   * Low-level API for custom searches.
   */
  async searchFoods(params: UsdaSearchParams): Promise<UsdaSearchResponse> {
    const requestParams: Record<string, string | number | boolean> = {
      query: params.query,
      pageSize: params.pageSize ?? 50,
      pageNumber: params.pageNumber ?? 1,
    };

    if (params.dataType && params.dataType.length > 0) {
      requestParams['dataType'] = params.dataType.join(",");
    }
    if (params.sortBy) requestParams['sortBy'] = params.sortBy;
    if (params.sortOrder) requestParams['sortOrder'] = params.sortOrder;
    if (params.brandOwner) requestParams['brandOwner'] = params.brandOwner;
    if (params.requireAllWords !== undefined) {
      requestParams['requireAllWords'] = params.requireAllWords;
    }

    const response = await this.request<UsdaSearchResponse>({
      path: "foods/search",
      params: requestParams,
    });

    return response.data;
  }

  /**
   * Fetch a specific food item by FDC ID.
   * Returns detailed nutrient and ingredient data.
   */
  async fetchFoodItem(fdcId: number): Promise<UsdaFoodItem> {
    const response = await this.request<UsdaFoodItem>({
      path: `food/${fdcId}`,
    });

    return response.data;
  }

  /**
   * Fetch multiple food items by FDC IDs.
   * More efficient than individual fetches.
   */
  async fetchFoodItems(fdcIds: number[]): Promise<UsdaFoodItem[]> {
    const response = await this.request<UsdaFoodItem[]>({
      path: "foods",
      method: "POST",
      body: { fdcIds },
    });

    return response.data;
  }

  /**
   * Execute the full USDA pipeline.
   * Searches for items containing additives and ingredients of concern.
   */
  async executeFullPipeline(): Promise<{
    itemsFetched: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ fdcId: string; error: string }>;
  }> {
    const pipelineLogger = createPipelineLogger("usda");
    const errors: Array<{ fdcId: string; error: string }> = [];
    let itemsFetched = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    pipelineLogger.info("Starting full USDA FoodData Central pipeline");

    // Search for each additive/ingredient query
    for (const query of USDA_INGREDIENT_QUERIES) {
      try {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const searchResult = await this.searchFoods({
            query,
            pageSize: 200,
            pageNumber: page,
          });

          const results = searchResult.foods ?? [];
          itemsFetched += results.length;

          for (const item of results) {
            try {
              const transformed = transformUsdaFoodItem(item);

              if (!transformed.isRelevant) {
                skipped++;
                continue;
              }

              const dedup = await this.deduplicate(transformed);
              if (dedup.exists && !dedup.hasChanged) continue;

              await this.persist(transformed, dedup);
              if (dedup.exists && dedup.hasChanged) {
                updated++;
              } else {
                created++;
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              errors.push({ fdcId: String(item.fdcId), error: errMsg });
            }
          }

          hasMore = page < (searchResult.totalPages ?? 1);
          page++;

          // Limit pages per query to manage API usage
          if (page > 5) break;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        pipelineLogger.warn({ query, error: errMsg }, "USDA search query failed, skipping");
      }
    }

    // Also fetch Foundation and SR Legacy data for common food categories
    try {
      const foundationFoods = await this.searchFoods({
        query: "food additive preservative color",
        dataType: ["Foundation", "SR Legacy"],
        pageSize: 200,
      });

      itemsFetched += foundationFoods.foods?.length ?? 0;

      for (const item of foundationFoods.foods ?? []) {
        try {
          const transformed = transformUsdaFoodItem(item);
          if (!transformed.isRelevant) {
            skipped++;
            continue;
          }

          const dedup = await this.deduplicate(transformed);
          if (dedup.exists && !dedup.hasChanged) continue;

          await this.persist(transformed, dedup);
          if (dedup.exists && dedup.hasChanged) {
            updated++;
          } else {
            created++;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          errors.push({ fdcId: String(item.fdcId), error: errMsg });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      pipelineLogger.warn({ error: errMsg }, "Foundation data fetch failed");
    }

    pipelineLogger.info(
      {
        itemsFetched,
        created,
        updated,
        skipped,
        errors: errors.length,
      },
      "Full USDA FoodData Central pipeline completed"
    );

    return {
      itemsFetched,
      created,
      updated,
      skipped,
      errors,
    };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Override buildUrl to handle USDA's API key format.
   * USDA uses "api_key" as the query parameter name.
   */
  protected override buildUrl(options: PipelineRequestOptions): string {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const path = options.path.startsWith("/") ? options.path : `/${options.path}`;
    const url = new URL(`${baseUrl}${path}`);

    // Add API key
    const apiKey = process.env[this.config.apiKeyEnvVar];
    if (apiKey) {
      url.searchParams.set("api_key", apiKey);
    }

    // Add query parameters
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }
}

// ============================================================================
// Singleton export
// ============================================================================
export const usdaClient = new UsdaClient();
