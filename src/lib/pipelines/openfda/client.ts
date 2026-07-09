// Cascada — openFDA Pipeline Client
// Concrete implementation of the openFDA data ingestion pipeline.
// Fetches food enforcement reports from the FDA's public API.
// API: https://api.fda.gov/
//
// Pipeline flow:
// 1. Fetch recent food enforcement (recall) records
// 2. Transform records into TransformedRegulatorySource
// 3. Deduplicate against existing records
// 4. Persist new/updated records
//
// openFDA rate limits: 240 requests/minute with or without an API key;
// API keys increase the daily request cap.

import { BasePipelineClient } from "../base-client";
import { PIPELINE_CONFIG } from "@/lib/constants";
import { PipelineError } from "@/lib/errors";
import { createPipelineLogger } from "@/lib/logger";
import { toDateString } from "@/utils/dates";
import type {
  PipelineSourceConfig,
  PipelineFetchResult,
  PipelineRequestOptions,
  TransformedRegulatorySource,
} from "../types";
import type {
  OpenFdaApiResponse,
  OpenFdaFoodEnforcement,
  OpenFdaEndpoint,
} from "./types";
import { canWritePipelineRecord } from "../relevance";
import { OPENFDA_ENDPOINTS } from "./types";
import { transformEnforcementRecord } from "./transforms";

// ============================================================================
// Pipeline configuration
// ============================================================================
const OPENFDA_CONFIG: PipelineSourceConfig = {
  type: "openfda",
  name: "openFDA",
  baseUrl: PIPELINE_CONFIG.OPENFDA.baseUrl,
  apiKeyEnvVar: "OPENFDA_API_KEY",
  apiKeyRequired: false, // API key is optional but increases rate limits
  rateLimit: {
    maxRequests: PIPELINE_CONFIG.OPENFDA.rateLimitPerMinute,
    intervalMs: 60000,
  },
  pollIntervalMinutes: PIPELINE_CONFIG.OPENFDA.pollIntervalMinutes,
  maxRecordsPerRun: 1000,
  defaultFilters: {},
  requestTimeoutMs: 30000,
};

// ============================================================================
// FDA endpoint fetch phases
// ============================================================================
type FdaFetchPhase = "enforcement";

interface FdaFetchPlan {
  phase: FdaFetchPhase;
  endpoint: OpenFdaEndpoint;
  searchQuery: string | null;
  currentSkip: number;
  limit: number;
}

// ============================================================================
// openFDA Pipeline Client
// ============================================================================
export class OpenFdaClient extends BasePipelineClient<
  OpenFdaFoodEnforcement,
  TransformedRegulatorySource
> {
  readonly pipelineType = "openfda" as const;
  readonly config = OPENFDA_CONFIG;

  // Fetch plan phases
  private fetchPlan: FdaFetchPlan[] = [];
  private currentPhaseIndex = 0;

  constructor() {
    super({
      maxRetries: PIPELINE_CONFIG.OPENFDA.maxRetries,
      baseDelayMs: PIPELINE_CONFIG.OPENFDA.retryDelayMs,
    });
  }

  // ==========================================================================
  // Abstract method implementations
  // ==========================================================================

  protected buildFetchRequest(
    cursor: string | null,
    limit: number
  ): PipelineRequestOptions {
    // Initialize fetch plan on first call
    if (!cursor) {
      this.initializeFetchPlan(limit);
      this.currentPhaseIndex = 0;
    } else {
      const parts = cursor.split("|");
      this.currentPhaseIndex = parseInt(parts[0] ?? "0", 10);
      const currentSkip = parseInt(parts[1] ?? "0", 10);
      if (this.fetchPlan[this.currentPhaseIndex]) {
        this.fetchPlan[this.currentPhaseIndex]!.currentSkip = currentSkip;
      }
    }

    const phase = this.fetchPlan[this.currentPhaseIndex];
    if (!phase) {
      return {
        path: OPENFDA_ENDPOINTS.FOOD_ENFORCEMENT,
        params: { limit: 0 }, // No more phases
      };
    }

    const params: Record<string, string | number> = {
      limit: phase.limit,
      skip: phase.currentSkip,
    };

    // Add search query if specified
    if (phase.searchQuery) {
      params['search'] = phase.searchQuery;
    }

    return {
      path: phase.endpoint,
      params,
    };
  }

  protected parseFetchResponse(
    responseData: unknown,
    _statusCode: number,
    _headers: Record<string, string>
  ): PipelineFetchResult<OpenFdaFoodEnforcement> {
    const apiResponse = responseData as OpenFdaApiResponse<OpenFdaFoodEnforcement>;

    // Check for API errors
    if (apiResponse.error) {
      // "NOT_FOUND" means no results — not an error
      if (apiResponse.error.code === "NOT_FOUND") {
        return {
          records: [],
          totalAvailable: 0,
          nextCursor: this.getNextPhaseCursor(),
          isLastPage: this.currentPhaseIndex >= this.fetchPlan.length - 1,
          metadata: { phase: this.currentPhaseIndex },
        };
      }
      throw new PipelineError("openfda", `openFDA API error: ${apiResponse.error.message}`, {
        code: apiResponse.error.code,
      });
    }

    const results = apiResponse.results ?? [];
    const totalAvailable = apiResponse.meta?.results?.total ?? results.length;
    const currentSkip = this.fetchPlan[this.currentPhaseIndex]?.currentSkip ?? 0;

    // Check if this is the last page for the current phase
    const isPhaseComplete = currentSkip + results.length >= totalAvailable;

    let nextCursor: string | null;
    if (isPhaseComplete) {
      nextCursor = this.getNextPhaseCursor();
    } else {
      nextCursor = `${this.currentPhaseIndex}|${currentSkip + results.length}`;
    }

    const isLastPage = isPhaseComplete && this.currentPhaseIndex >= this.fetchPlan.length - 1;

    return {
      records: results,
      totalAvailable,
      nextCursor,
      isLastPage,
      metadata: {
        phase: this.currentPhaseIndex,
        skip: apiResponse.meta?.results?.skip,
        limit: apiResponse.meta?.results?.limit,
      },
    };
  }

  transform(raw: OpenFdaFoodEnforcement): TransformedRegulatorySource {
    return transformEnforcementRecord(raw);
  }

  // ==========================================================================
  // openFDA-specific methods
  // ==========================================================================

  /**
   * Fetch recent food enforcement records with date filtering.
   * Only fetches records since the given date for incremental updates.
   */
  async fetchRecentEnforcements(sinceDate: string): Promise<OpenFdaFoodEnforcement[]> {
    const allResults: OpenFdaFoodEnforcement[] = [];
    let skip = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await this.request<
        OpenFdaApiResponse<OpenFdaFoodEnforcement>
      >({
        path: OPENFDA_ENDPOINTS.FOOD_ENFORCEMENT,
        params: {
          search: `recall_initiation_date:[${sinceDate} TO ${toDateString(new Date())}]`,
          limit,
          skip,
          sort: "recall_initiation_date:desc",
        },
      });

      const results = response.data.results ?? [];
      allResults.push(...results);

      const totalAvailable = response.data.meta?.results?.total ?? 0;
      hasMore = skip + results.length < totalAvailable;
      skip += results.length;

      // Safety limit: don't fetch more than 1000 records per call
      if (allResults.length >= 1000) break;
    }

    return allResults;
  }

  /**
   * Search enforcement records by a custom query.
   * Supports openFDA's Lucene-based search syntax.
   */
  async searchEnforcements(
    query: string,
    limit: number = 100
  ): Promise<OpenFdaFoodEnforcement[]> {
    const response = await this.request<
      OpenFdaApiResponse<OpenFdaFoodEnforcement>
    >({
      path: OPENFDA_ENDPOINTS.FOOD_ENFORCEMENT,
      params: {
        search: query,
        limit: Math.min(limit, 100),
      },
    });

    return response.data.results ?? [];
  }

  /**
   * Execute the full openFDA pipeline.
   * Fetches only the official food enforcement endpoint.
   */
  async executeFullPipeline(sinceDate?: string): Promise<{
    enforcementsFetched: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ sourceId: string; error: string }>;
  }> {
    const pipelineLogger = createPipelineLogger("openfda");
    const errors: Array<{ sourceId: string; error: string }> = [];
    let enforcementsFetched = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const dateFilter = sinceDate ?? this.getDefaultSinceDate();

    pipelineLogger.info({ sinceDate: dateFilter }, "Starting full openFDA pipeline execution");

    // Phase 1: Enforcement records
    try {
      const enforcements = await this.fetchRecentEnforcements(dateFilter);
      enforcementsFetched = enforcements.length;

      for (const record of enforcements) {
        try {
          const transformed = transformEnforcementRecord(record);
          if (!canWritePipelineRecord(transformed)) {
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
          errors.push({ sourceId: record.recall_number, error: errMsg });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      pipelineLogger.error({ error: errMsg }, "Enforcement fetch phase failed");
      errors.push({ sourceId: "enforcement-phase", error: errMsg });
    }

    pipelineLogger.info(
      {
        enforcementsFetched,
        created,
        updated,
        skipped,
        errors: errors.length,
      },
      "Full openFDA pipeline completed"
    );

    return {
      enforcementsFetched,
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
   * Initialize the fetch plan for the official food enforcement endpoint.
   */
  private initializeFetchPlan(limit: number): void {
    const sinceDate = this.getDefaultSinceDate();
    const today = toDateString(new Date());

    this.fetchPlan = [
      {
        phase: "enforcement",
        endpoint: OPENFDA_ENDPOINTS.FOOD_ENFORCEMENT,
        searchQuery: `recall_initiation_date:[${sinceDate} TO ${today}]`,
        currentSkip: 0,
        limit: Math.min(limit, 100),
      },
    ];
  }

  /**
   * Get the cursor for the next phase.
   * Returns null if all phases are complete.
   */
  private getNextPhaseCursor(): string | null {
    const nextIndex = this.currentPhaseIndex + 1;
    if (nextIndex >= this.fetchPlan.length) {
      return null;
    }
    return `${nextIndex}|0`;
  }

  /**
   * Get the default "since" date for incremental fetches.
   * Defaults to 30 days ago.
   */
  private getDefaultSinceDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    const iso = date.toISOString();
    return iso.substring(0, iso.indexOf("T"));
  }

  /**
   * Override buildUrl to handle openFDA's API key format.
   * openFDA uses "api_key" as the query parameter name.
   */
  protected override buildUrl(options: PipelineRequestOptions): string {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const path = options.path.startsWith("/") ? options.path : `/${options.path}`;
    const url = new URL(`${baseUrl}${path}`);

    // Add API key with openFDA's parameter name
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
export const openFdaClient = new OpenFdaClient();
