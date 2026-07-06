// Cascada — LegiScan Pipeline Client
// Concrete implementation of the LegiScan data ingestion pipeline.
// LegiScan tracks legislation across all 50 US states and Congress.
// API: https://api.legiscan.com/
//
// Pipeline flow:
// 1. Search for food-related bills across target states
// 2. Fetch full bill details for relevant results
// 3. Transform bill data into TransformedRegulatorySource
// 4. Deduplicate against existing records
// 5. Persist new/updated records
//
// LegiScan API has a rate limit of ~2 requests/second on the paid plan.

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
  LegiScanApiResponse,
  LegiScanSearchResults,
  LegiScanBillDetail,
  LegiScanMasterListResult,
  LegiScanMasterListBill,
  LegiScanSearchParams,
  LegiScanSessionList,
  LegiScanSearchResultItem,
} from "./types";
import { LEGISCAN_FOOD_QUERIES } from "./types";
import { transformBillDetail, transformSearchResult, transformMasterListBill } from "./transforms";

// ============================================================================
// Pipeline configuration
// ============================================================================
const LEGISCAN_CONFIG: PipelineSourceConfig = {
  type: "legiscan",
  name: "LegiScan",
  baseUrl: PIPELINE_CONFIG.LEGISCAN.baseUrl,
  apiKeyEnvVar: "LEGISCAN_API_KEY",
  apiKeyRequired: true,
  rateLimit: {
    maxRequests: PIPELINE_CONFIG.LEGISCAN.rateLimitPerSecond * 60, // Per minute window
    intervalMs: 60000,
  },
  pollIntervalMinutes: PIPELINE_CONFIG.LEGISCAN.pollIntervalMinutes,
  maxRecordsPerRun: 500,
  defaultFilters: {},
  requestTimeoutMs: 30000,
};

// ============================================================================
// State priority for monitoring
// States with the most active food regulation legislation are checked first.
// ============================================================================
const PRIORITY_STATES: readonly string[] = [
  "CA", // California — most active food regulation (AB 418, Prop 65, etc.)
  "NY", // New York — active on food additives
  "TX", // Texas — SB 25, food safety
  "WA", // Washington — PFAS, food packaging
  "IL", // Illinois — food safety legislation
  "MA", // Massachusetts — food additive bills
  "PA", // Pennsylvania — active food regulation
  "NJ", // New Jersey — food safety
  "MD", // Maryland — food labeling
  "CO", // Colorado — PFAS, food packaging
  "OR", // Oregon — food safety
  "CT", // Connecticut — food additives
  "MI", // Michigan — food safety
  "VA", // Virginia — food regulation
  "MN", // Minnesota — PFAS legislation
  // Remaining states checked less frequently
  "AZ", "FL", "GA", "HI", "NV", "NM", "NC", "OH", "VT", "WI",
] as const;

// ============================================================================
// LegiScan Pipeline Client
// ============================================================================
export class LegiScanClient extends BasePipelineClient<
  LegiScanSearchResultItem | LegiScanBillDetail | LegiScanMasterListBill,
  TransformedRegulatorySource
> {
  readonly pipelineType = "legiscan" as const;
  readonly config = LEGISCAN_CONFIG;

  // Track which states have been fetched in this run
  private fetchedStates: Set<string> = new Set();
  // Queue of search queries to execute
  private queryQueue: Array<{ state: string; query: string }> = [];
  // Current query being processed
  private currentQueryIndex = 0;
  // Current page within a query
  private currentPage = 1;

  constructor() {
    super({
      maxRetries: PIPELINE_CONFIG.LEGISCAN.maxRetries,
      baseDelayMs: PIPELINE_CONFIG.LEGISCAN.retryDelayMs,
    });
  }

  // ==========================================================================
  // Abstract method implementations
  // ==========================================================================

  protected buildFetchRequest(
    cursor: string | null,
    limit: number
  ): PipelineRequestOptions {
    // The cursor format is: "{state}|{queryIndex}|{page}"
    // If no cursor, start with the first query
    if (!cursor) {
      this.initializeQueryQueue();
      this.currentQueryIndex = 0;
      this.currentPage = 1;
    } else {
      const parts = cursor.split("|");
      this.currentQueryIndex = parseInt(parts[0] ?? "0", 10);
      this.currentPage = parseInt(parts[1] ?? "1", 10);
    }

    const query = this.queryQueue[this.currentQueryIndex];
    if (!query) {
      // No more queries — return empty result
      return {
        path: "/",
        params: { op: "search", query: "__no_more_queries__" },
      };
    }

    return {
      path: "/",
      params: {
        op: "search",
        state: query.state,
        query: query.query,
        page: this.currentPage,
      },
    };
  }

  protected parseFetchResponse(
    responseData: unknown,
    _statusCode: number,
    _headers: Record<string, string>
  ): PipelineFetchResult<LegiScanSearchResultItem> {
    const apiResponse = responseData as LegiScanApiResponse<LegiScanSearchResults>;

    if (apiResponse.status === "ERROR") {
      throw new PipelineError("legiscan", "LegiScan API returned error status", {
        response: apiResponse,
      });
    }

    const results = apiResponse.result;
    const summary = results.summary;

    // Determine if there are more pages
    const isLastPage = summary.page >= summary.page_count;
    const nextCursor = isLastPage
      ? this.getNextQueryCursor()
      : `${this.currentQueryIndex}|${summary.page + 1}`;

    return {
      records: results.results,
      totalAvailable: summary.total,
      nextCursor: isLastPage ? nextCursor : nextCursor,
      isLastPage: isLastPage && this.currentQueryIndex >= this.queryQueue.length - 1,
      metadata: {
        page: summary.page,
        pageCount: summary.page_count,
        queryIndex: this.currentQueryIndex,
        totalResults: summary.total,
      },
    };
  }

  transform(
    raw: LegiScanSearchResultItem | LegiScanBillDetail | LegiScanMasterListBill
  ): TransformedRegulatorySource {
    if ("bill_type" in raw && "session" in raw) {
      // Full bill detail
      return transformBillDetail(raw as LegiScanBillDetail);
    } else if ("relevance" in raw) {
      // Search result item
      return transformSearchResult(raw as LegiScanSearchResultItem);
    } else {
      // Master list bill — need state code from context
      // For master list bills, we use the state from the query queue
      const currentState = this.queryQueue[this.currentQueryIndex]?.state ?? "US";
      return transformMasterListBill(raw as LegiScanMasterListBill, currentState);
    }
  }

  // ==========================================================================
  // LegiScan-specific methods
  // ==========================================================================

  /**
   * Fetch full bill details for a specific bill ID.
   * This is used after an initial search finds relevant bills.
   * The search results only contain summary info; full details require a separate call.
   */
  async fetchBillDetail(billId: number): Promise<LegiScanBillDetail> {
    const response = await this.request<LegiScanApiResponse<{ bill: LegiScanBillDetail }>>({
      path: "/",
      params: {
        op: "getBill",
        id: billId,
      },
    });

    if (response.data.status === "ERROR") {
      throw new PipelineError("legiscan", `Failed to fetch bill ${billId}`, {
        billId,
        response: response.data,
      });
    }

    return response.data.result.bill;
  }

  /**
   * Fetch the full text content of a bill.
   * Bills often have multiple text versions (introduced, amended, enrolled).
   * We fetch the most recent version.
   */
  async fetchBillText(docId: number): Promise<string> {
    const response = await this.request<LegiScanApiResponse<{ text: string }>>({
      path: "/",
      params: {
        op: "getBillText",
        id: docId,
      },
    });

    if (response.data.status === "ERROR") {
      throw new PipelineError("legiscan", `Failed to fetch bill text for doc ${docId}`, {
        docId,
        response: response.data,
      });
    }

    return response.data.result.text;
  }

  /**
   * Get the master list of all bills for a specific state session.
   * This is more efficient than searching when we want all bills for a state.
   */
  async fetchMasterList(
    state: string,
    sessionId?: number
  ): Promise<LegiScanMasterListResult> {
    const params: Record<string, string | number> = {
      op: "getMasterList",
      state,
    };

    if (sessionId) {
      params['id'] = sessionId;
    }

    const response = await this.request<LegiScanApiResponse<LegiScanMasterListResult>>({
      path: "/",
      params,
    });

    if (response.data.status === "ERROR") {
      throw new PipelineError(
        "legiscan",
        `Failed to fetch master list for ${state}`,
        { state, sessionId, response: response.data }
      );
    }

    return response.data.result;
  }

  /**
   * Get available sessions for a state.
   * Used to determine the current legislative session for monitoring.
   */
  async fetchSessionList(state: string): Promise<LegiScanSessionList> {
    const response = await this.request<LegiScanApiResponse<LegiScanSessionList>>({
      path: "/",
      params: {
        op: "getSessionList",
        state,
      },
    });

    if (response.data.status === "ERROR") {
      throw new PipelineError(
        "legiscan",
        `Failed to fetch session list for ${state}`,
        { state, response: response.data }
      );
    }

    return response.data.result;
  }

  /**
   * Search for bills matching specific criteria.
   * Low-level API for custom searches beyond the default food queries.
   */
  async searchBills(params: LegiScanSearchParams): Promise<LegiScanSearchResults> {
    const requestParams: Record<string, string | number> = {
      op: "search",
      query: params.query,
    };

    if (params.state) requestParams['state'] = params.state;
    if (params.bill) requestParams['bill'] = params.bill;
    if (params.session) requestParams['id'] = params.session;
    if (params.year) requestParams['year'] = params.year;
    if (params.page) requestParams['page'] = params.page;

    const response = await this.request<LegiScanApiResponse<LegiScanSearchResults>>({
      path: "/",
      params: requestParams,
    });

    if (response.data.status === "ERROR") {
      throw new PipelineError(
        "legiscan",
        `LegiScan search failed for query: ${params.query}`,
        { params, response: response.data }
      );
    }

    return response.data.result;
  }

  /**
   * Execute the full LegiScan pipeline with enhanced flow:
   * 1. Search for food-related bills across priority states
   * 2. Fetch full details for bills that pass relevance check
   * 3. Fetch bill text for highly relevant bills
   * 4. Transform and persist all relevant records
   */
  async executeFullPipeline(): Promise<{
    searchResults: number;
    billDetailsFetched: number;
    billTextsFetched: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ billId: string; error: string }>;
  }> {
    const pipelineLogger = createPipelineLogger("legiscan");
    const errors: Array<{ billId: string; error: string }> = [];
    let searchResults = 0;
    let billDetailsFetched = 0;
    let billTextsFetched = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    pipelineLogger.info("Starting full LegiScan pipeline execution");

    // Phase 1: Search for food-related bills across priority states
    for (const query of LEGISCAN_FOOD_QUERIES) {
      for (const state of PRIORITY_STATES) {
        try {
          let page = 1;
          let hasMore = true;

          while (hasMore) {
            const results = await this.searchBills({
              query,
              state,
              page,
            });

            searchResults += results.results.length;

            // Phase 2: Fetch full details for relevant bills
            for (const searchResult of results.results) {
              try {
                // Quick relevance check on search result
                const transformed = transformSearchResult(searchResult);

                if (!transformed.isRelevant) {
                  skipped++;
                  continue;
                }

                // Fetch full bill detail
                const billDetail = await this.fetchBillDetail(searchResult.bill_id);
                billDetailsFetched++;

                const detailedTransform = transformBillDetail(billDetail);

                if (!detailedTransform.isRelevant) {
                  skipped++;
                  continue;
                }

                // Phase 3: Fetch bill text for highly relevant bills
                if (billDetail.texts.length > 0) {
                  try {
                    // Get the most recent text version
                    const latestText = billDetail.texts[billDetail.texts.length - 1];
                    if (latestText) {
                      const billText = await this.fetchBillText(latestText.doc_id);
                      billTextsFetched++;
                      detailedTransform.fullText = billText;
                    }
                  } catch (textError) {
                    pipelineLogger.warn(
                      { billId: searchResult.bill_id, error: String(textError) },
                      "Failed to fetch bill text, continuing without it"
                    );
                  }
                }

                // Phase 4: Deduplicate and persist
                const dedup = await this.deduplicate(detailedTransform);
                if (dedup.exists && !dedup.hasChanged) {
                  continue; // No changes, skip
                }

                const recordId = await this.persist(detailedTransform, dedup);
                if (dedup.exists && dedup.hasChanged) {
                  updated++;
                } else {
                  created++;
                }

                pipelineLogger.debug(
                  { billId: searchResult.bill_id, recordId, created: !dedup.exists },
                  "Bill processed"
                );
              } catch (billError) {
                const errMsg = billError instanceof Error ? billError.message : String(billError);
                errors.push({ billId: String(searchResult.bill_id), error: errMsg });
                pipelineLogger.warn(
                  { billId: searchResult.bill_id, error: errMsg },
                  "Failed to process bill"
                );
              }
            }

            // Pagination
            hasMore = page < results.summary.page_count;
            page++;

            // Limit pages per query to avoid excessive API usage
            if (page > 5) {
              pipelineLogger.debug(
                { query, state, pagesFetched: page - 1 },
                "Reached page limit for query"
              );
              break;
            }
          }
        } catch (searchError) {
          const errMsg = searchError instanceof Error ? searchError.message : String(searchError);
          pipelineLogger.warn(
            { query, state, error: errMsg },
            "Search query failed, skipping"
          );
        }
      }
    }

    pipelineLogger.info(
      {
        searchResults,
        billDetailsFetched,
        billTextsFetched,
        created,
        updated,
        skipped,
        errors: errors.length,
      },
      "Full LegiScan pipeline completed"
    );

    return {
      searchResults,
      billDetailsFetched,
      billTextsFetched,
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
   * Initialize the query queue with food-related search queries
   * across priority states.
   */
  private initializeQueryQueue(): void {
    this.queryQueue = [];

    for (const state of PRIORITY_STATES) {
      // Add the most important queries for each state
      // Limit to avoid excessive API usage per run
      const topQueries = LEGISCAN_FOOD_QUERIES.slice(0, 8);
      for (const query of topQueries) {
        this.queryQueue.push({ state, query });
      }
    }
  }

  /**
   * Get the cursor for the next query in the queue.
   * Returns null if we've exhausted all queries.
   */
  private getNextQueryCursor(): string | null {
    const nextIndex = this.currentQueryIndex + 1;
    if (nextIndex >= this.queryQueue.length) {
      return null;
    }
    return `${nextIndex}|1`;
  }
}

// ============================================================================
// Singleton export
// ============================================================================
export const legiScanClient = new LegiScanClient();
