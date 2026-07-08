// Cascada — Base Pipeline Client
// Abstract base class for all data ingestion pipeline clients.
// Handles rate limiting, retry with exponential backoff, deduplication,
// structured logging, and pipeline run tracking.
//
// Every concrete pipeline (LegiScan, openFDA, Federal Register, USDA)
// extends this class and implements the abstract methods.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createPipelineLogger } from "@/lib/logger";
import { PipelineError } from "@/lib/errors";
import { createHash } from "crypto";
import type {
  PipelineType,
  PipelineRunContext,
  PipelineExecutionResult,
  PipelineBoundedExecutionOptions,
  PipelineBoundedExecutionResult,
  PipelinePreviewRecord,
  PipelineRecordError,
  PipelineFetchResult,
  DeduplicationCheck,
  PipelineSourceConfig,
  PipelineRequestOptions,
  PipelineResponse,
  RateLimitState,
  RetryConfig,
  TransformedRegulatorySource,
} from "./types";
import { DEFAULT_RETRY_CONFIG } from "./types";
import { getPipelineCredentialStatus } from "./credentials";
import type { SourceStatus } from "@prisma/client";

// ============================================================================
// Abstract base class
// ============================================================================
export abstract class BasePipelineClient<TRaw, TTransformed extends TransformedRegulatorySource> {
  abstract readonly pipelineType: PipelineType;
  abstract readonly config: PipelineSourceConfig;

  protected rateLimitState: RateLimitState;
  protected retryConfig: RetryConfig;

  constructor(retryConfig?: Partial<RetryConfig>) {
    this.rateLimitState = {
      requestTimestamps: [],
      inFlight: 0,
      maxConcurrent: 5,
    };
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  // ==========================================================================
  // Abstract methods — each pipeline must implement these
  // ==========================================================================

  /** Build the request options for fetching a page of records */
  protected abstract buildFetchRequest(
    cursor: string | null,
    limit: number,
  ): PipelineRequestOptions;

  /** Parse the raw HTTP response into our typed FetchResult */
  protected abstract parseFetchResponse(
    responseData: unknown,
    statusCode: number,
    headers: Record<string, string>,
  ): PipelineFetchResult<TRaw>;

  /** Transform a single raw API record into our internal format */
  abstract transform(raw: TRaw): TTransformed;

  // ==========================================================================
  // HTTP client with rate limiting and retry
  // ==========================================================================

  /**
   * Execute an HTTP request with rate limiting, retry logic, and error handling.
   * This is the ONLY way pipeline clients make HTTP requests.
   */
  protected async request<TResponseBody>(
    options: PipelineRequestOptions,
  ): Promise<PipelineResponse<TResponseBody>> {
    await this.enforceRateLimit();

    const url = this.buildUrl(options);
    const headers = this.buildHeaders(options);
    const timeout = options.timeoutMs ?? 30000;

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= this.retryConfig.maxRetries) {
      attempt++;
      try {
        this.rateLimitState.inFlight++;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          method: options.method ?? "GET",
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        this.rateLimitState.inFlight--;

        // Extract rate limit info from response headers
        const rateLimitInfo = this.extractRateLimitInfo(response.headers);

        // Handle rate limiting from the API
        if (response.status === 429) {
          const resetAt = rateLimitInfo.resetAt ?? new Date(Date.now() + 60000);
          const waitMs = Math.max(resetAt.getTime() - Date.now(), 1000);

          const pipelineLogger = createPipelineLogger(this.pipelineType);
          pipelineLogger.warn(
            { waitMs, attempt, remaining: rateLimitInfo.remaining },
            "API rate limit hit, waiting before retry",
          );

          await this.sleep(waitMs);
          continue; // Don't count rate limit as a retry attempt
        }

        // Handle retryable server errors
        if (this.retryConfig.retryableStatusCodes.includes(response.status)) {
          lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);

          if (attempt <= this.retryConfig.maxRetries) {
            const delay = this.calculateRetryDelay(attempt);
            const pipelineLogger = createPipelineLogger(this.pipelineType);
            pipelineLogger.warn(
              { status: response.status, attempt, delayMs: delay, url: options.path },
              "Retryable HTTP error, backing off",
            );
            await this.sleep(delay);
            continue;
          }
        }

        // Handle non-retryable errors
        if (!response.ok) {
          const body = await response.text().catch(() => "unable to read body");
          throw new PipelineError(
            this.pipelineType,
            `HTTP ${response.status}: ${response.statusText} — ${body}`,
            {
              statusCode: response.status,
              url: options.path,
              attempt,
            },
          );
        }

        // Parse successful response
        const data = (await response.json()) as TResponseBody;
        const responseHeaders = this.headersToObject(response.headers);

        return {
          data,
          statusCode: response.status,
          headers: responseHeaders,
          rateLimit: rateLimitInfo,
        };
      } catch (error) {
        this.rateLimitState.inFlight = Math.max(0, this.rateLimitState.inFlight - 1);

        if (error instanceof PipelineError) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry abort errors
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new PipelineError(this.pipelineType, `Request timed out after ${timeout}ms`, {
            url: options.path,
            timeout,
          });
        }

        if (attempt <= this.retryConfig.maxRetries) {
          const delay = this.calculateRetryDelay(attempt);
          const pipelineLogger = createPipelineLogger(this.pipelineType);
          pipelineLogger.warn(
            { error: lastError.message, attempt, delayMs: delay, url: options.path },
            "Request failed, backing off",
          );
          await this.sleep(delay);
        }
      }
    }

    throw new PipelineError(
      this.pipelineType,
      `All ${attempt} attempts failed. Last error: ${lastError?.message ?? "unknown"}`,
      { url: options.path, attempts: attempt },
    );
  }

  // ==========================================================================
  // Rate limiting
  // ==========================================================================

  /**
   * Enforce the rate limit before making a request.
   * Sliding window algorithm based on timestamps.
   */
  protected async enforceRateLimit(): Promise<void> {
    const config = this.config.rateLimit;
    const now = Date.now();
    const windowStart = now - config.intervalMs;

    // Remove timestamps outside the current window
    this.rateLimitState.requestTimestamps = this.rateLimitState.requestTimestamps.filter(
      (ts) => ts > windowStart,
    );

    // If we've hit the limit, wait until the oldest request exits the window
    if (this.rateLimitState.requestTimestamps.length >= config.maxRequests) {
      const oldestInWindow = this.rateLimitState.requestTimestamps[0] ?? now;
      const waitMs = oldestInWindow + config.intervalMs - now + 10; // +10ms buffer

      if (waitMs > 0) {
        const pipelineLogger = createPipelineLogger(this.pipelineType);
        pipelineLogger.debug(
          {
            waitMs,
            currentRequests: this.rateLimitState.requestTimestamps.length,
            maxRequests: config.maxRequests,
          },
          "Rate limit reached, waiting",
        );
        await this.sleep(waitMs);
      }
    }

    // Wait for concurrency slot
    while (this.rateLimitState.inFlight >= this.rateLimitState.maxConcurrent) {
      await this.sleep(100);
    }

    // Record this request
    this.rateLimitState.requestTimestamps.push(Date.now());
  }

  // ==========================================================================
  // Deduplication
  // ==========================================================================

  /**
   * Check if a transformed record already exists in our database.
   * Uses sourceId + sourceType as the unique identifier.
   * Compares content hashes to detect changes.
   */
  async deduplicate(transformed: TTransformed): Promise<DeduplicationCheck> {
    const contentHash = this.computeContentHash(transformed.rawApiResponse);

    const existing = await prisma.regulatorySource.findFirst({
      where: {
        sourceType: transformed.sourceType,
        sourceId: transformed.sourceId,
      },
      select: {
        id: true,
        rawApiResponse: true,
      },
    });

    if (!existing) {
      return {
        exists: false,
        existingId: null,
        hasChanged: false,
        contentHash,
      };
    }

    // Compare content hashes to detect changes
    const existingHash = this.computeContentHash(
      existing.rawApiResponse as Record<string, unknown>,
    );
    const hasChanged = existingHash !== contentHash;

    return {
      exists: true,
      existingId: existing.id,
      hasChanged,
      contentHash,
    };
  }

  /**
   * Compute a deterministic SHA-256 hash of a record's raw API response.
   * Used for change detection without comparing entire payloads.
   */
  protected computeContentHash(data: Record<string, unknown>): string {
    const serialized = JSON.stringify(data, Object.keys(data).sort());
    return createHash("sha256").update(serialized).digest("hex").slice(0, 16);
  }

  // ==========================================================================
  // Relevance filtering
  // ==========================================================================

  /**
   * Determine if a record is relevant to food manufacturing regulation.
   * Uses keyword matching against the title, description, and text.
   * This prevents us from storing irrelevant bills about traffic laws, etc.
   */
  protected isRelevantToFoodManufacturing(
    textFields: string[],
    keywords: readonly string[],
  ): { isRelevant: boolean; matchedKeywords: string[] } {
    const combinedText = textFields.join(" ").toLowerCase();
    const matchedKeywords: string[] = [];

    for (const keyword of keywords) {
      if (combinedText.includes(keyword.toLowerCase())) {
        matchedKeywords.push(keyword);
      }
    }

    // A record is relevant if it matches at least one keyword
    // Some pipelines may override this with stricter logic
    return {
      isRelevant: matchedKeywords.length > 0,
      matchedKeywords,
    };
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Persist a transformed record to the database.
   * Handles both creation and updates based on deduplication results.
   */
  async persist(transformed: TTransformed, dedup: DeduplicationCheck): Promise<string> {
    const createData = this.buildPersistenceData(transformed, transformed.status);

    if (!dedup.exists) {
      // Create new record
      const record = await prisma.regulatorySource.upsert({
        where: {
          sourceType_sourceId: {
            sourceType: transformed.sourceType,
            sourceId: transformed.sourceId,
          },
        },
        create: createData,
        update: this.buildPersistenceData(
          transformed,
          transformed.status,
          false,
        ) as Prisma.RegulatorySourceUncheckedUpdateInput,
      });
      return record.id;
    }

    if (dedup.hasChanged) {
      // Update existing record — content has changed since last fetch
      await prisma.regulatorySource.update({
        where: { id: dedup.existingId! },
        data: this.buildPersistenceData(
          transformed,
          mapExternalStatusToSourceStatus(transformed.status),
          false,
        ) as Prisma.RegulatorySourceUncheckedUpdateInput,
      });
      return dedup.existingId!;
    }

    // No changes — skip
    return dedup.existingId!;
  }

  protected buildPersistenceData(
    transformed: TTransformed,
    status: SourceStatus,
    includeCreateOnlyFields: boolean = true,
  ): Prisma.RegulatorySourceUncheckedCreateInput {
    const data = {
      sourceType: transformed.sourceType,
      jurisdiction: transformed.jurisdiction,
      name: transformed.name,
      title: transformed.title ?? transformed.name,
      summary: transformed.summary ?? null,
      sourceId: transformed.sourceId,
      sourceUrl: transformed.sourceUrl,
      citationUrl: transformed.citationUrl ?? transformed.sourceUrl,
      status,
      publishedAt: transformed.publishedAt ?? transformed.introducedDate,
      observedAt: transformed.observedAt ?? new Date(),
      sourceAgency: transformed.sourceAgency ?? null,
      documentType: transformed.documentType ?? transformed.sourceType,
      introducedDate: transformed.introducedDate,
      enactedDate: transformed.enactedDate,
      effectiveDate: transformed.effectiveDate,
      fullText: transformed.fullText,
      rawApiResponse: transformed.rawApiResponse as unknown as Prisma.InputJsonValue,
      relevantCategories: transformed.relevantCategories as unknown as Prisma.InputJsonValue,
      matchMetadata: (transformed.matchMetadata ?? {
        isRelevant: transformed.isRelevant,
        relevantCategories: transformed.relevantCategories,
      }) as unknown as Prisma.InputJsonValue,
      processingError: null,
    };

    if (!includeCreateOnlyFields) {
      return data;
    }

    return {
      ...data,
      processedAt: null,
    };
  }

  // ==========================================================================
  // Pipeline execution
  // ==========================================================================

  /**
   * Execute the full pipeline: fetch → transform → deduplicate → persist.
   * This is the main entry point for running a pipeline.
   * Tracks the run in the PipelineRun table for observability.
   */
  async execute(cursor?: string | null): Promise<PipelineExecutionResult> {
    const pipelineLogger = createPipelineLogger(this.pipelineType);
    const startTime = Date.now();

    // Create a PipelineRun record to track this execution
    const run = await prisma.pipelineRun.create({
      data: {
        pipelineType: this.pipelineType,
        status: "running",
        recordsProcessed: 0,
        recordsNew: 0,
        recordsUpdated: 0,
        recordsFailed: 0,
        startedAt: new Date(),
      },
    });

    const context: PipelineRunContext = {
      runId: run.id,
      pipelineType: this.pipelineType,
      startedAt: new Date(),
      recordsProcessed: 0,
      recordsNew: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      errorDetail: null,
    };

    const errors: PipelineRecordError[] = [];
    let currentCursor = cursor ?? null;
    let hasMorePages = true;
    let totalFetched = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalDuplicates = 0;

    pipelineLogger.info({ runId: run.id, cursor }, "Pipeline execution started");

    try {
      while (hasMorePages) {
        // Fetch a page of records
        let fetchResult: PipelineFetchResult<TRaw>;

        try {
          const requestOpts = this.buildFetchRequest(currentCursor, 100);
          const response = await this.request<unknown>(requestOpts);
          fetchResult = this.parseFetchResponse(
            response.data,
            response.statusCode,
            response.headers,
          );
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          pipelineLogger.error({ error: errMsg, cursor: currentCursor }, "Fetch failed");

          errors.push({
            sourceId: `page-${currentCursor ?? "first"}`,
            error: errMsg,
            stage: "fetch",
            retryable: true,
          });

          // If the first page fails, abort the entire run
          if (totalFetched === 0) {
            throw error;
          }
          break;
        }

        totalFetched += fetchResult.records.length;
        pipelineLogger.info(
          {
            fetched: fetchResult.records.length,
            totalFetched,
            totalAvailable: fetchResult.totalAvailable,
          },
          "Page fetched",
        );

        // Process each record
        for (const rawRecord of fetchResult.records) {
          try {
            // Step 1: Transform
            const transformed = this.transform(rawRecord);

            // Step 2: Filter for relevance
            if (!transformed.isRelevant) {
              totalSkipped++;
              continue;
            }

            // Step 3: Deduplicate
            const dedup = await this.deduplicate(transformed);

            if (dedup.exists && !dedup.hasChanged) {
              totalDuplicates++;
              continue;
            }

            // Step 4: Persist
            await this.persist(transformed, dedup);

            if (dedup.exists && dedup.hasChanged) {
              totalUpdated++;
            } else {
              totalCreated++;
            }

            context.recordsProcessed++;
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            context.recordsFailed++;
            totalFetched++;

            pipelineLogger.error(
              { error: errMsg, recordIndex: context.recordsProcessed },
              "Record processing failed",
            );

            errors.push({
              sourceId: `record-${context.recordsProcessed}`,
              error: errMsg,
              stage: "persist",
              retryable: false,
            });
          }
        }

        // Check if there are more pages
        currentCursor = fetchResult.nextCursor;
        hasMorePages = !fetchResult.isLastPage && fetchResult.records.length > 0;

        // Check max records per run limit
        if (
          this.config.maxRecordsPerRun > 0 &&
          context.recordsProcessed >= this.config.maxRecordsPerRun
        ) {
          pipelineLogger.info(
            { processed: context.recordsProcessed, max: this.config.maxRecordsPerRun },
            "Max records per run reached",
          );
          break;
        }
      }

      const durationMs = Date.now() - startTime;

      // Update the PipelineRun record
      await prisma.pipelineRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          recordsProcessed: context.recordsProcessed,
          recordsNew: totalCreated,
          recordsUpdated: totalUpdated,
          recordsFailed: context.recordsFailed,
          completedAt: new Date(),
          duration: durationMs,
        },
      });

      pipelineLogger.info(
        {
          runId: run.id,
          durationMs,
          fetched: totalFetched,
          created: totalCreated,
          updated: totalUpdated,
          skipped: totalSkipped,
          duplicates: totalDuplicates,
          failed: context.recordsFailed,
        },
        "Pipeline execution completed",
      );

      return {
        pipelineType: this.pipelineType,
        durationMs,
        fetched: totalFetched,
        created: totalCreated,
        updated: totalUpdated,
        failed: context.recordsFailed,
        skipped: totalSkipped,
        duplicates: totalDuplicates,
        errors,
        status: "completed",
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);

      // Update the PipelineRun record with error
      await prisma.pipelineRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          recordsProcessed: context.recordsProcessed,
          recordsNew: totalCreated,
          recordsUpdated: totalUpdated,
          recordsFailed: context.recordsFailed + 1,
          errorDetail: errMsg,
          completedAt: new Date(),
          duration: durationMs,
        },
      });

      pipelineLogger.error(
        {
          runId: run.id,
          durationMs,
          error: errMsg,
          fetched: totalFetched,
          created: totalCreated,
          updated: totalUpdated,
        },
        "Pipeline execution failed",
      );

      return {
        pipelineType: this.pipelineType,
        durationMs,
        fetched: totalFetched,
        created: totalCreated,
        updated: totalUpdated,
        failed: context.recordsFailed + 1,
        skipped: totalSkipped,
        duplicates: totalDuplicates,
        errors: [
          ...errors,
          {
            sourceId: "pipeline",
            error: errMsg,
            stage: "fetch",
            retryable: true,
          },
        ],
        status: "failed",
      };
    }
  }

  /**
   * Execute a small bounded run. Dry-runs fetch, transform, and dedupe without
   * persisting source records. Write mode is explicit and creates a PipelineRun.
   */
  async executeBounded(
    options: PipelineBoundedExecutionOptions,
  ): Promise<PipelineBoundedExecutionResult> {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const startTime = startedAtDate.getTime();
    const credentialStatus = getPipelineCredentialStatus(this.config);
    const errors: PipelineRecordError[] = [];
    const previews: PipelinePreviewRecord[] = [];

    if (!credentialStatus.configured) {
      const completedAt = new Date().toISOString();
      return {
        pipelineType: this.pipelineType,
        sourceName: this.config.name,
        mode: options.mode,
        limit: options.limit,
        startedAt,
        completedAt,
        durationMs: Date.now() - startTime,
        status: "blocked",
        recordsFetched: 0,
        recordsTransformed: 0,
        recordsWritten: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        dedupeHits: 0,
        pipelineRunId: null,
        errors,
        previews,
        blockedReason: "not_configured",
        message: credentialStatus.message,
      };
    }

    const run =
      options.mode === "write"
        ? await prisma.pipelineRun.create({
            data: {
              pipelineType: this.pipelineType,
              status: "running",
              recordsProcessed: 0,
              recordsNew: 0,
              recordsUpdated: 0,
              recordsFailed: 0,
              startedAt: startedAtDate,
            },
          })
        : null;

    let currentCursor = options.cursor ?? null;
    let hasMorePages = true;
    let remaining = options.limit;
    let recordsFetched = 0;
    let recordsTransformed = 0;
    let recordsCreated = 0;
    let recordsUpdated = 0;
    let recordsSkipped = 0;
    let dedupeHits = 0;

    try {
      while (hasMorePages && remaining > 0) {
        const requestLimit = Math.min(remaining, 100);
        const requestOpts = this.buildFetchRequest(currentCursor, requestLimit);
        const response = await this.request<unknown>(requestOpts);
        const fetchResult = this.parseFetchResponse(
          response.data,
          response.statusCode,
          response.headers,
        );

        const pageRecords = fetchResult.records.slice(0, remaining);
        recordsFetched += pageRecords.length;

        for (const rawRecord of pageRecords) {
          try {
            const transformed = this.transform(rawRecord);
            recordsTransformed++;
            remaining--;

            if (!transformed.isRelevant) {
              recordsSkipped++;
              previews.push(this.buildPreview(transformed, false, false));
              continue;
            }

            const dedup = await this.deduplicate(transformed);
            const duplicate = dedup.exists && !dedup.hasChanged;

            previews.push(this.buildPreview(transformed, duplicate, dedup.hasChanged));

            if (duplicate) {
              dedupeHits++;
              continue;
            }

            if (options.mode === "write") {
              await this.persist(transformed, dedup);
              if (dedup.exists && dedup.hasChanged) {
                recordsUpdated++;
              } else {
                recordsCreated++;
              }
            }
          } catch (error) {
            errors.push({
              sourceId: `record-${recordsTransformed}`,
              error: error instanceof Error ? error.message : String(error),
              stage: "persist",
              retryable: false,
            });
          }
        }

        currentCursor = fetchResult.nextCursor;
        hasMorePages = !fetchResult.isLastPage && fetchResult.records.length > 0;
      }

      const completedAtDate = new Date();
      const status = errors.length > 0 ? "failed" : "completed";

      if (run) {
        await prisma.pipelineRun.update({
          where: { id: run.id },
          data: {
            status,
            recordsProcessed: recordsTransformed,
            recordsNew: recordsCreated,
            recordsUpdated,
            recordsFailed: errors.length,
            errorDetail: errors[0]?.error ?? null,
            completedAt: completedAtDate,
            duration: completedAtDate.getTime() - startTime,
          },
        });
      }

      return {
        pipelineType: this.pipelineType,
        sourceName: this.config.name,
        mode: options.mode,
        limit: options.limit,
        startedAt,
        completedAt: completedAtDate.toISOString(),
        durationMs: completedAtDate.getTime() - startTime,
        status,
        recordsFetched,
        recordsTransformed,
        recordsWritten: recordsCreated + recordsUpdated,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        dedupeHits,
        pipelineRunId: run?.id ?? null,
        errors,
        previews: previews.slice(0, options.limit),
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      errors.push({
        sourceId: `page-${currentCursor ?? "first"}`,
        error: errMsg,
        stage: "fetch",
        retryable: true,
      });

      const completedAtDate = new Date();

      if (run) {
        await prisma.pipelineRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            recordsProcessed: recordsTransformed,
            recordsNew: recordsCreated,
            recordsUpdated,
            recordsFailed: errors.length,
            errorDetail: errMsg,
            completedAt: completedAtDate,
            duration: completedAtDate.getTime() - startTime,
          },
        });
      }

      return {
        pipelineType: this.pipelineType,
        sourceName: this.config.name,
        mode: options.mode,
        limit: options.limit,
        startedAt,
        completedAt: completedAtDate.toISOString(),
        durationMs: completedAtDate.getTime() - startTime,
        status: "failed",
        recordsFetched,
        recordsTransformed,
        recordsWritten: recordsCreated + recordsUpdated,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        dedupeHits,
        pipelineRunId: run?.id ?? null,
        errors,
        previews: previews.slice(0, options.limit),
      };
    }
  }

  protected buildPreview(
    transformed: TTransformed,
    duplicate: boolean,
    changed: boolean,
  ): PipelinePreviewRecord {
    return {
      sourceId: transformed.sourceId,
      sourceType: transformed.sourceType,
      name: transformed.name,
      jurisdiction: transformed.jurisdiction,
      sourceUrl: transformed.sourceUrl,
      status: transformed.status,
      isRelevant: transformed.isRelevant,
      duplicate,
      changed,
    };
  }

  // ==========================================================================
  // Health check
  // ==========================================================================

  /**
   * Validate that this pipeline can connect to its external API.
   * Makes a lightweight request to verify connectivity and authentication.
   */
  async healthCheck(): Promise<boolean> {
    const originalRetryConfig = this.retryConfig;

    try {
      const credentialStatus = getPipelineCredentialStatus(this.config);
      if (!credentialStatus.configured) return false;

      const requestOpts = this.buildFetchRequest(null, 1);
      this.retryConfig = { ...this.retryConfig, maxRetries: 0 };

      const response = await this.request<unknown>({
        ...requestOpts,
        timeoutMs: 5000,
      });
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch {
      return false;
    } finally {
      this.retryConfig = originalRetryConfig;
    }
  }

  // ==========================================================================
  // Utility methods
  // ==========================================================================

  /**
   * Build the full URL for a request by combining base URL with path and params.
   */
  protected buildUrl(options: PipelineRequestOptions): string {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");
    const path = options.path.startsWith("/") ? options.path : `/${options.path}`;
    const url = new URL(`${baseUrl}${path}`);

    // Add API key if configured
    const apiKey = process.env[this.config.apiKeyEnvVar];
    if (apiKey) {
      url.searchParams.set("api_key", apiKey);
    }

    // Add query parameters
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  /**
   * Build request headers.
   */
  protected buildHeaders(options: PipelineRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Cascada/0.1.0 (Food Regulatory Intelligence)",
      ...options.headers,
    };

    if (options.body) {
      headers["Content-Type"] = "application/json";
    }

    return headers;
  }

  /**
   * Calculate the delay before the next retry attempt.
   * Uses exponential backoff with optional jitter.
   */
  protected calculateRetryDelay(attempt: number): number {
    const baseDelay = this.retryConfig.baseDelayMs;
    const multiplier = this.retryConfig.backoffMultiplier;
    const maxDelay = this.retryConfig.maxDelayMs;

    let delay = baseDelay * Math.pow(multiplier, attempt - 1);
    delay = Math.min(delay, maxDelay);

    if (this.retryConfig.jitter) {
      // Add random jitter between 0 and 50% of the delay
      const jitter = delay * 0.5 * Math.random();
      delay += jitter;
    }

    return Math.floor(delay);
  }

  /**
   * Extract rate limit information from response headers.
   * Different APIs use different header names, so we check multiple patterns.
   */
  protected extractRateLimitInfo(headers: Headers): {
    remaining: number | null;
    resetAt: Date | null;
    limit: number | null;
  } {
    // Standard patterns across different APIs
    const remaining =
      headers.get("x-ratelimit-remaining") ??
      headers.get("x-rate-limit-remaining") ??
      headers.get("ratelimit-remaining");

    const limit =
      headers.get("x-ratelimit-limit") ??
      headers.get("x-rate-limit-limit") ??
      headers.get("ratelimit-limit");

    const reset =
      headers.get("x-ratelimit-reset") ??
      headers.get("x-rate-limit-reset") ??
      headers.get("ratelimit-reset");

    return {
      remaining: remaining ? parseInt(remaining, 10) : null,
      limit: limit ? parseInt(limit, 10) : null,
      resetAt: reset ? new Date(parseInt(reset, 10) * 1000) : null,
    };
  }

  /**
   * Convert a Headers object to a plain Record.
   */
  protected headersToObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Sleep for the specified number of milliseconds.
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Helper: map external source status to our SourceStatus enum
// ============================================================================
function mapExternalStatusToSourceStatus(currentStatus: SourceStatus): SourceStatus {
  // If the record was previously SME-approved, a change in external data
  // should reset it back to DETECTED for re-processing
  // Otherwise, keep the current status
  if (currentStatus === "SME_APPROVED" || currentStatus === "SME_REJECTED") {
    return "DETECTED";
  }
  return currentStatus;
}
