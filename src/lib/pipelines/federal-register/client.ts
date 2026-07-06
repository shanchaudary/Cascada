// Cascada — Federal Register Pipeline Client
// Concrete implementation of the Federal Register data ingestion pipeline.
// Fetches FDA rules, proposed rules, and notices from the Federal Register.
// API: https://www.federalregister.gov/api/v1/
//
// Pipeline flow:
// 1. Search for food-related documents from FDA and related agencies
// 2. Fetch full document details
// 3. Transform into TransformedRegulatorySource
// 4. Deduplicate against existing records
// 5. Persist new/updated records
//
// Rate limit: 1000 requests/hour (with API key).

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
  FederalRegisterSearchResponse,
  FederalRegisterDocument,
  FederalRegisterSearchParams,
  FederalRegisterDocumentType,
} from "./types";
import { FEDERAL_REGISTER_FOOD_CONDITIONS } from "./types";
import { transformFederalRegisterDocument } from "./transforms";

// ============================================================================
// Pipeline configuration
// ============================================================================
const FEDERAL_REGISTER_CONFIG: PipelineSourceConfig = {
  type: "federal_register",
  name: "Federal Register",
  baseUrl: PIPELINE_CONFIG.FEDERAL_REGISTER.baseUrl,
  apiKeyEnvVar: "FEDERAL_REGISTER_API_KEY",
  apiKeyRequired: false,
  rateLimit: {
    maxRequests: PIPELINE_CONFIG.FEDERAL_REGISTER.rateLimitPerHour,
    intervalMs: 3600000, // 1 hour
  },
  pollIntervalMinutes: PIPELINE_CONFIG.FEDERAL_REGISTER.pollIntervalMinutes,
  maxRecordsPerRun: 500,
  defaultFilters: {},
  requestTimeoutMs: 30000,
};

// ============================================================================
// Federal Register Pipeline Client
// ============================================================================
export class FederalRegisterClient extends BasePipelineClient<
  FederalRegisterDocument,
  TransformedRegulatorySource
> {
  readonly pipelineType = "federal_register" as const;
  readonly config = FEDERAL_REGISTER_CONFIG;

  // Search conditions queue
  private searchConditions: FederalRegisterSearchParams[] = [];
  private currentConditionIndex = 0;
  private currentPage = 1;

  constructor() {
    super({
      maxRetries: PIPELINE_CONFIG.FEDERAL_REGISTER.maxRetries,
      baseDelayMs: PIPELINE_CONFIG.FEDERAL_REGISTER.retryDelayMs,
    });
  }

  // ==========================================================================
  // Abstract method implementations
  // ==========================================================================

  protected buildFetchRequest(
    cursor: string | null,
    limit: number
  ): PipelineRequestOptions {
    // Initialize search conditions on first call
    if (!cursor) {
      this.searchConditions = [...FEDERAL_REGISTER_FOOD_CONDITIONS];
      this.currentConditionIndex = 0;
      this.currentPage = 1;
    } else {
      const parts = cursor.split("|");
      this.currentConditionIndex = parseInt(parts[0] ?? "0", 10);
      this.currentPage = parseInt(parts[1] ?? "1", 10);
    }

    const condition = this.searchConditions[this.currentConditionIndex];
    if (!condition) {
      return { path: "documents.json", params: { per_page: 0 } };
    }

    const params: Record<string, string | number> = {
      per_page: Math.min(limit, 100),
      page: this.currentPage,
      order: condition.order ?? "newest",
    };

    // Add document type filter
    if (condition.type && condition.type.length > 0) {
      params["type[]"] = condition.type.join(",");
    }

    // Add agency filter
    if (condition.agencies && condition.agencies.length > 0) {
      params["agencies[]"] = condition.agencies.join(",");
    }

    // Add search conditions
    if (condition.conditions?.keyword) {
      params["conditions[keyword]"] = condition.conditions.keyword;
    }
    if (condition.conditions?.full_text) {
      params["conditions[full_text]"] = condition.conditions.full_text;
    }

    // Add date range
    if (condition.publication_date?.gte) {
      params["publication_date[gte]"] = condition.publication_date.gte;
    }
    if (condition.publication_date?.lte) {
      params["publication_date[lte]"] = condition.publication_date.lte;
    }

    // Request full text and metadata
    params["fields[]"] = [
      "document_number",
      "title",
      "type",
      "abstract",
      "publication_date",
      "effective_date",
      "action",
      "agencies",
      "subjects",
      "topics",
      "citation",
      "html_url",
      "pdf_url",
      "body_html",
      "body_text",
      "excerpts",
      "comments_close_on",
      "significant",
      "rin",
    ].join(",");

    return {
      path: "documents.json",
      params,
    };
  }

  protected parseFetchResponse(
    responseData: unknown,
    _statusCode: number,
    _headers: Record<string, string>
  ): PipelineFetchResult<FederalRegisterDocument> {
    const apiResponse = responseData as FederalRegisterSearchResponse;

    const results = apiResponse.results ?? [];
    const totalPages = apiResponse.total_pages ?? 1;

    // Check if current condition has more pages
    const isConditionComplete = this.currentPage >= totalPages;

    let nextCursor: string | null;
    if (isConditionComplete) {
      // Move to next search condition
      const nextIndex = this.currentConditionIndex + 1;
      if (nextIndex >= this.searchConditions.length) {
        nextCursor = null;
      } else {
        nextCursor = `${nextIndex}|1`;
      }
    } else {
      nextCursor = `${this.currentConditionIndex}|${this.currentPage + 1}`;
    }

    const isLastPage =
      isConditionComplete &&
      this.currentConditionIndex >= this.searchConditions.length - 1;

    return {
      records: results,
      totalAvailable: apiResponse.count ?? 0,
      nextCursor,
      isLastPage,
      metadata: {
        conditionIndex: this.currentConditionIndex,
        page: this.currentPage,
        totalPages,
      },
    };
  }

  transform(raw: FederalRegisterDocument): TransformedRegulatorySource {
    return transformFederalRegisterDocument(raw);
  }

  // ==========================================================================
  // Federal Register-specific methods
  // ==========================================================================

  /**
   * Fetch a specific document by its document number.
   * Useful for re-fetching or updating individual records.
   */
  async fetchDocument(documentNumber: string): Promise<FederalRegisterDocument> {
    const response = await this.request<FederalRegisterDocument>({
      path: `documents/${documentNumber}.json`,
    });

    return response.data;
  }

  /**
   * Search for documents matching specific criteria.
   * Low-level API for custom searches.
   */
  async searchDocuments(
    params: FederalRegisterSearchParams
  ): Promise<FederalRegisterSearchResponse> {
    const requestParams: Record<string, string | number> = {
      per_page: params.per_page ?? 100,
      page: params.page ?? 1,
      order: params.order ?? "newest",
    };

    if (params.type && params.type.length > 0) {
      requestParams["type[]"] = params.type.join(",");
    }
    if (params.agencies && params.agencies.length > 0) {
      requestParams["agencies[]"] = params.agencies.join(",");
    }
    if (params.conditions?.keyword) {
      requestParams["conditions[keyword]"] = params.conditions.keyword;
    }
    if (params.publication_date?.gte) {
      requestParams["publication_date[gte]"] = params.publication_date.gte;
    }
    if (params.publication_date?.lte) {
      requestParams["publication_date[lte]"] = params.publication_date.lte;
    }

    const response = await this.request<FederalRegisterSearchResponse>({
      path: "documents.json",
      params: requestParams,
    });

    return response.data;
  }

  /**
   * Fetch recent FDA rules and proposed rules.
   * Only fetches documents published since the given date.
   */
  async fetchRecentFdaDocuments(
    sinceDate: string,
    documentTypes: FederalRegisterDocumentType[] = ["RULE", "PROPOSED RULE", "NOTICE"]
  ): Promise<FederalRegisterDocument[]> {
    const allResults: FederalRegisterDocument[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await this.searchDocuments({
        agencies: ["food-and-drug-administration"],
        type: documentTypes,
        publication_date: {
          gte: sinceDate,
          lte: toDateString(new Date()),
        },
        order: "newest",
        per_page: 100,
        page,
      });

      const results = response.results ?? [];
      allResults.push(...results);

      hasMore = page < (response.total_pages ?? 1);
      page++;

      // Safety limit
      if (allResults.length >= 500) break;
    }

    return allResults;
  }

  /**
   * Execute the full Federal Register pipeline.
   * Fetches from all configured search conditions.
   */
  async executeFullPipeline(sinceDate?: string): Promise<{
    documentsFetched: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ documentNumber: string; error: string }>;
  }> {
    const pipelineLogger = createPipelineLogger("federal_register");
    const errors: Array<{ documentNumber: string; error: string }> = [];
    let documentsFetched = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    const dateFilter = sinceDate ?? this.getDefaultSinceDate();

    pipelineLogger.info({ sinceDate: dateFilter }, "Starting full Federal Register pipeline");

    // Phase 1: Fetch recent FDA documents with date filter
    try {
      const documents = await this.fetchRecentFdaDocuments(dateFilter);
      documentsFetched += documents.length;

      for (const doc of documents) {
        try {
          const transformed = transformFederalRegisterDocument(doc);

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
          errors.push({ documentNumber: doc.document_number, error: errMsg });
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      pipelineLogger.error({ error: errMsg }, "FDA document fetch phase failed");
      errors.push({ documentNumber: "fda-phase", error: errMsg });
    }

    // Phase 2: Search for food-related documents using each search condition
    for (let i = 0; i < FEDERAL_REGISTER_FOOD_CONDITIONS.length; i++) {
      const condition = FEDERAL_REGISTER_FOOD_CONDITIONS[i]!;

      // Skip conditions without keywords (handled in Phase 1)
      if (!condition.conditions?.keyword) continue;

      try {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          const searchResult = await this.searchDocuments({
            ...condition,
            publication_date: {
              gte: dateFilter,
              lte: toDateString(new Date()),
            },
            page,
          });

          const results = searchResult.results ?? [];
          documentsFetched += results.length;

          for (const doc of results) {
            try {
              const transformed = transformFederalRegisterDocument(doc);

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
              errors.push({ documentNumber: doc.document_number, error: errMsg });
            }
          }

          hasMore = page < (searchResult.total_pages ?? 1);
          page++;

          // Limit pages per condition
          if (page > 3) break;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        pipelineLogger.warn(
          { conditionIndex: i, error: errMsg },
          "Search condition failed, skipping"
        );
      }
    }

    pipelineLogger.info(
      {
        documentsFetched,
        created,
        updated,
        skipped,
        errors: errors.length,
      },
      "Full Federal Register pipeline completed"
    );

    return {
      documentsFetched,
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
   * Override buildUrl to handle Federal Register's URL structure.
   * API key is passed as a query parameter.
   */
  protected override buildUrl(options: PipelineRequestOptions): string {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const path = options.path.startsWith("/") ? options.path.slice(1) : options.path;
    const url = new URL(`${baseUrl}/${path}`);

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
export const federalRegisterClient = new FederalRegisterClient();
