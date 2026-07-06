// Cascada — LLM Fallback Routing
// When the primary model fails, automatically retry with the fallback model.
// Handles rate limits, timeouts, and structured output failures.
// Every fallback attempt is logged for observability.

import { LLM_CONFIG } from "@/lib/constants";
import {
  LlmError,
  LlmRateLimitError,
  LlmStructuredOutputError,
} from "@/lib/errors";
import { createLlmLogger } from "@/lib/logger";
import { isRetryableLlmError, isStructuredOutputRetryable } from "./client";
import type { LlmTaskType } from "./client";

// ============================================================================
// Types
// ============================================================================

export interface FallbackResult<T> {
  result: T;
  usedFallback: boolean;
  primaryError: Error | null;
  totalAttempts: number;
  totalLatencyMs: number;
}

// ============================================================================
// Fallback execution
// ============================================================================

/**
 * Execute an LLM operation with automatic fallback to a secondary provider.
 *
 * Strategy:
 * 1. Try primary model
 * 2. On retryable error (rate limit, timeout, 5xx) → try fallback model
 * 3. On structured output failure → retry with same model (up to maxRetries)
 * 4. On non-retryable error → throw immediately
 *
 * The fallback function receives the task type so it can select the right model.
 */
export async function executeWithFallback<T>(
  primaryFn: () => Promise<T>,
  fallbackFn: () => Promise<T>,
  taskType: LlmTaskType
): Promise<FallbackResult<T>> {
  const logger = createLlmLogger("system", taskType);
  const startTime = Date.now();
  let attempts = 0;

  // ---- Attempt 1: Primary model ----
  attempts++;
  try {
    const result = await primaryFn();
    return {
      result,
      usedFallback: false,
      primaryError: null,
      totalAttempts: attempts,
      totalLatencyMs: Date.now() - startTime,
    };
  } catch (primaryError) {
    const primaryErr = primaryError instanceof Error ? primaryError : new Error(String(primaryError));
    logger.warn(
      {
        taskType,
        attempt: attempts,
        error: primaryErr.message,
        errorName: primaryErr.constructor.name,
      },
      "Primary model failed"
    );

    // Non-retryable? Throw immediately.
    if (!isRetryableLlmError(primaryError) && !isStructuredOutputRetryable(primaryError)) {
      logger.error(
        { taskType, error: primaryErr.message },
        "Non-retryable error from primary model, not attempting fallback"
      );
      throw primaryError;
    }

    // ---- Attempt 2: Fallback model ----
    attempts++;
    try {
      const result = await fallbackFn();
      logger.info(
        {
          taskType,
          totalAttempts: attempts,
          latencyMs: Date.now() - startTime,
        },
        "Fallback model succeeded"
      );
      return {
        result,
        usedFallback: true,
        primaryError: primaryErr,
        totalAttempts: attempts,
        totalLatencyMs: Date.now() - startTime,
      };
    } catch (fallbackError) {
      const fallbackErr = fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
      logger.error(
        {
          taskType,
          primaryError: primaryErr.message,
          fallbackError: fallbackErr.message,
          totalAttempts: attempts,
        },
        "Both primary and fallback models failed"
      );

      // Return the more descriptive error
      throw new LlmError(
        `Both models failed. Primary: ${primaryErr.message}. Fallback: ${fallbackErr.message}`,
        "multiple",
        {
          taskType,
          primaryError: primaryErr.message,
          fallbackError: fallbackErr.message,
          totalAttempts: attempts,
        }
      );
    }
  }
}

// ============================================================================
// Retry with exponential backoff
// ============================================================================

/**
 * Execute an async function with exponential backoff retry.
 * Used for transient failures within a single model (not for cross-model fallback).
 *
 * Backoff formula: baseDelay * 2^attempt + jitter
 * Jitter prevents thundering herd when multiple calls retry simultaneously.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    taskType?: LlmTaskType;
  } = {}
): Promise<T> {
  const {
    maxRetries = LLM_CONFIG.MAX_RETRIES,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    taskType = "rule_parsing",
  } = options;

  const logger = createLlmLogger("system", taskType);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt >= maxRetries) {
        logger.error(
          { attempt, maxRetries, error: lastError.message },
          "Max retries exceeded"
        );
        break;
      }

      // Calculate backoff with jitter
      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000,
        maxDelayMs
      );

      logger.warn(
        {
          attempt: attempt + 1,
          maxRetries,
          delayMs: Math.round(delayMs),
          error: lastError.message,
        },
        "Retrying LLM call after failure"
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError ?? new LlmError("Retry loop ended without error", "unknown", { taskType });
}

// ============================================================================
// Batch processing with concurrency control
// ============================================================================

/**
 * Process multiple LLM calls concurrently with a concurrency limit.
 * Used when parsing multiple regulatory sources in parallel.
 * Each call gets its own fallback handling.
 */
export async function processBatchWithConcurrency<TItem, TResult>(
  items: TItem[],
  processor: (item: TItem, index: number) => Promise<TResult>,
  options: {
    concurrency?: number;
    taskType?: LlmTaskType;
    onItemError?: (item: TItem, error: Error) => void;
  } = {}
): Promise<Array<{ item: TItem; result: TResult | null; error: Error | null }>> {
  const {
    concurrency = 3,
    taskType = "rule_parsing",
    onItemError,
  } = options;

  const logger = createLlmLogger("system", taskType);
  const results: Array<{ item: TItem; result: TResult | null; error: Error | null }> = [];

  // Process in chunks of `concurrency`
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);

    const chunkResults = await Promise.allSettled(
      chunk.map(async (item, chunkIndex) => {
        const globalIndex = i + chunkIndex;
        try {
          const result = await processor(item, globalIndex);
          return { item, result, error: null };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          onItemError?.(item, err);
          logger.warn(
            { index: globalIndex, error: err.message },
            "Batch item failed"
          );
          return { item, result: null, error: err };
        }
      })
    );

    for (const settled of chunkResults) {
      if (settled.status === "fulfilled") {
        results.push(settled.value);
      } else {
        // This shouldn't happen since we catch errors above, but handle defensively
        logger.error(
          { reason: settled.reason },
          "Unexpected settled rejection in batch processing"
        );
        results.push({ item: items[results.length] as TItem, result: null, error: new Error(settled.reason) });
      }
    }
  }

  logger.info(
    {
      totalItems: items.length,
      successful: results.filter((r) => r.result !== null).length,
      failed: results.filter((r) => r.error !== null).length,
    },
    "Batch processing completed"
  );

  return results;
}
