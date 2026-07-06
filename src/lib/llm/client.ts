// Cascada — Unified LLM Client
// Vercel AI SDK with OpenAI primary, Anthropic fallback.
// All LLM calls go through this module. No direct API calls anywhere else.
// Structured output via generateObject() — never free-form chat for data extraction.

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { type LanguageModel } from "ai";
import { LLM_CONFIG } from "@/lib/constants";
import { LlmError, LlmRateLimitError } from "@/lib/errors";
import { createLlmLogger } from "@/lib/logger";

// ============================================================================
// Provider initialization (lazy singletons)
// ============================================================================

let openaiModel: ReturnType<typeof createOpenAI> | null = null;
let anthropicModel: ReturnType<typeof createAnthropic> | null = null;

function getOpenAIProvider(): ReturnType<typeof createOpenAI> {
  if (!openaiModel) {
    const apiKey = process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      throw new LlmError(
        "OPENAI_API_KEY environment variable is not set",
        "openai",
        { provider: "openai" }
      );
    }
    openaiModel = createOpenAI({
      apiKey,
    });
  }
  return openaiModel;
}

function getAnthropicProvider(): ReturnType<typeof createAnthropic> {
  if (!anthropicModel) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new LlmError(
        "ANTHROPIC_API_KEY environment variable is not set",
        "anthropic",
        { provider: "anthropic" }
      );
    }
    anthropicModel = createAnthropic({
      apiKey,
    });
  }
  return anthropicModel;
}

// ============================================================================
// Model selection by task type
// ============================================================================

export type LlmTaskType =
  | "rule_parsing"
  | "substance_extraction"
  | "ingredient_matching"
  | "query_agent"
  | "reformulation"
  | "diagnostic_analysis"
  | "timeline_conflict"
  | "decision_package";

/**
 * Get the appropriate temperature for a task type.
 * Rule parsing must be deterministic; reformulation can be creative.
 */
export function getTemperatureForTask(taskType: LlmTaskType): number {
  switch (taskType) {
    case "rule_parsing":
    case "substance_extraction":
    case "ingredient_matching":
    case "timeline_conflict":
      return LLM_CONFIG.TEMPERATURE.RULE_PARSING; // 0.0
    case "query_agent":
      return LLM_CONFIG.TEMPERATURE.QUERY_AGENT; // 0.3
    case "reformulation":
    case "diagnostic_analysis":
    case "decision_package":
      return LLM_CONFIG.TEMPERATURE.REFORMULATION; // 0.5
    default:
      return 0.0;
  }
}

/**
 * Get the model ID for a given task type.
 * Heavy analytical tasks use GPT-4o; lighter tasks use GPT-4o-mini.
 */
export function getModelIdForTask(taskType: LlmTaskType): string {
  switch (taskType) {
    case "rule_parsing":
    case "substance_extraction":
    case "decision_package":
    case "diagnostic_analysis":
      return LLM_CONFIG.PRIMARY_MODEL; // gpt-4o
    case "ingredient_matching":
    case "query_agent":
    case "reformulation":
    case "timeline_conflict":
      return "gpt-4o-mini";
    default:
      return LLM_CONFIG.PRIMARY_MODEL;
  }
}

/**
 * Get the fallback model ID for a given task type.
 */
export function getFallbackModelIdForTask(taskType: LlmTaskType): string {
  // All tasks fall back to Claude 3.5 Sonnet
  void taskType;
  return LLM_CONFIG.FALLBACK_MODEL;
}

// ============================================================================
// Model instance creation
// ============================================================================

/**
 * Get a LanguageModelV1 instance for the specified model ID.
 * Supports both OpenAI and Anthropic models.
 */
export function getModel(modelId: string): LanguageModel {
  const logger = createLlmLogger(modelId, "model-selection");

  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-")) {
    const provider = getOpenAIProvider();
    logger.debug({ modelId, provider: "openai" }, "Selected OpenAI model");
    return provider(modelId);
  }

  if (modelId.startsWith("claude-")) {
    const provider = getAnthropicProvider();
    logger.debug({ modelId, provider: "anthropic" }, "Selected Anthropic model");
    return provider(modelId);
  }

  throw new LlmError(`Unknown model ID: ${modelId}`, modelId, {
    modelId,
    knownPrefixes: ["gpt-", "o1-", "o3-", "claude-"],
  });
}

/**
 * Get the primary model for a task type.
 */
export function getPrimaryModel(taskType: LlmTaskType): LanguageModel {
  const modelId = getModelIdForTask(taskType);
  return getModel(modelId);
}

/**
 * Get the fallback model for a task type.
 */
export function getFallbackModel(taskType: LlmTaskType): LanguageModel {
  const modelId = getFallbackModelIdForTask(taskType);
  return getModel(modelId);
}

// ============================================================================
// Cost calculation
// ============================================================================

/**
 * Calculate the cost of an LLM call based on token usage and model.
 */
export function calculateLlmCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = LLM_CONFIG.COST_PER_TOKEN[model as keyof typeof LLM_CONFIG.COST_PER_TOKEN];
  if (!pricing) {
    // Unknown model — estimate conservatively at GPT-4o rates
    const fallback = LLM_CONFIG.COST_PER_TOKEN["gpt-4o"];
    return promptTokens * fallback.prompt + completionTokens * fallback.completion;
  }
  return promptTokens * pricing.prompt + completionTokens * pricing.completion;
}

// ============================================================================
// Error classification
// ============================================================================

/**
 * Classify an LLM error to determine if fallback should be attempted.
 */
export function isRetryableLlmError(error: unknown): boolean {
  if (error instanceof LlmRateLimitError) {
    return true; // Try fallback provider
  }
  if (error instanceof LlmError) {
    const retryableCodes = [429, 500, 502, 503, 504];
    return retryableCodes.includes(error.statusCode);
  }
  if (error instanceof Error) {
    const retryableMessages = [
      "rate limit",
      "too many requests",
      "overloaded",
      "timeout",
      "ECONNRESET",
      "ETIMEDOUT",
    ];
    const message = error.message.toLowerCase();
    return retryableMessages.some((m) => message.includes(m));
  }
  return false;
}

/**
 * Determine if a structured output failure should trigger a retry.
 * These happen when the LLM produces invalid JSON that doesn't match the schema.
 */
export function isStructuredOutputRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const retryablePatterns = [
      "Could not generate",
      "Schema validation failed",
      "Invalid structured output",
      "JSON parse error",
      "Type mismatch",
    ];
    const message = error.message;
    return retryablePatterns.some((p) => message.includes(p));
  }
  return false;
}
