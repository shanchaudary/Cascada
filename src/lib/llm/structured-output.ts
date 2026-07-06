// Cascada — Structured Output Zod Schemas
// Enforces that ALL LLM output conforms to Zod schemas via generateObject().
// No free-form chat for data extraction — every LLM call produces validated JSON.

import { z } from "zod";
import { generateObject } from "ai";
import {
  getPrimaryModel,
  getFallbackModel,
  getTemperatureForTask,
  getModelIdForTask,
  getFallbackModelIdForTask,
  calculateLlmCost,
  type LlmTaskType,
} from "./client";
import { LLM_CONFIG } from "@/lib/constants";
import { LlmStructuredOutputError, LlmError } from "@/lib/errors";
import { createLlmLogger } from "@/lib/logger";
import { logLlmUsage } from "./cost-tracker";
import { executeWithFallback } from "./fallback";

// ============================================================================
// Rule Parsing Output Schema
// ============================================================================

export const ParsedRuleSchema = z.object({
  rules: z.array(
    z.object({
      ruleType: z.enum([
        "BAN",
        "WARNING_LABEL",
        "DISCLOSURE",
        "PHASE_OUT",
        "CONCENTRATION_LIMIT",
        "REPORTING",
        "CERTIFICATION",
        "INGREDIENT_REVIEW",
        "MARKET_WITHDRAWAL",
      ]),
      description: z.string().min(10, "Description must be at least 10 characters"),
      effectiveDate: z.string().nullable().describe("ISO 8601 date or null if unknown"),
      complianceDate: z.string().nullable().describe("ISO 8601 date or null if unknown"),
      gracePeriodDays: z.number().int().min(0).nullable(),
      penaltyType: z.enum(["civil", "criminal", "product_ban", "fine_per_violation"]).nullable(),
      penaltyAmount: z.number().min(0).nullable().describe("Penalty amount in USD"),
      exemptions: z.array(
        z.object({
          description: z.string(),
          productCategories: z.array(z.string()),
          conditions: z.array(z.string()),
        })
      ),
      substances: z.array(
        z.object({
          substanceName: z.string().min(1, "Substance name is required"),
          substanceType: z.enum(["specific_chemical", "chemical_class", "functional_category"]),
          casNumber: z.string().nullable(),
          eenumber: z.string().nullable(),
          threshold: z.number().min(0).nullable(),
          thresholdUnit: z.string().nullable(),
          productScope: z.array(z.string()).nullable(),
        })
      ).min(1, "At least one substance must be identified"),
    })
  ),
  summary: z.string().min(20, "Summary must be at least 20 characters"),
  confidence: z.number().min(0).max(1).describe("Overall confidence in the parsing, 0-1"),
  jurisdictionConfirmed: z.string().describe("The jurisdiction identified from the text"),
  sourceTypeConfirmed: z.enum([
    "STATE_BILL",
    "FEDERAL_BILL",
    "FDA_RULE",
    "FDA_GUIDANCE",
    "FDA_PROPOSED_RULE",
    "FEDERAL_REGISTER_NOTICE",
    "RETAILER_MANDATE",
    "INTERNATIONAL_REGULATION",
  ]).describe("The source type confirmed from the text"),
});

export type ParsedRuleOutput = z.infer<typeof ParsedRuleSchema>;

// ============================================================================
// Substance Extraction Schema (standalone, for re-extraction)
// ============================================================================

export const SubstanceExtractionSchema = z.object({
  substances: z.array(
    z.object({
      substanceName: z.string().min(1),
      substanceType: z.enum(["specific_chemical", "chemical_class", "functional_category"]),
      casNumber: z.string().nullable(),
      eenumber: z.string().nullable(),
      commonAliases: z.array(z.string()).describe("Other names this substance is known by"),
      functionalCategory: z.string().nullable().describe("e.g., 'dye', 'preservative', 'flavor'"),
      knownHealthConcerns: z.array(z.string()).describe("Health concerns cited in the text"),
      threshold: z.number().nullable(),
      thresholdUnit: z.string().nullable(),
      productScope: z.array(z.string()).nullable(),
      isAdditiveOfConcern: z.boolean().describe("Whether this is a known food additive of concern"),
    })
  ),
  extractionConfidence: z.number().min(0).max(1),
});

export type SubstanceExtractionOutput = z.infer<typeof SubstanceExtractionSchema>;

// ============================================================================
// Ingredient Matching Schema
// ============================================================================

export const IngredientMatchSchema = z.object({
  matches: z.array(
    z.object({
      substanceName: z.string(),
      matchedIngredientId: z.string().nullable().describe("CUID of matched ingredient or null"),
      matchedIngredientName: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      method: z.enum(["exact", "alias", "cas_number", "eenumber", "llm_inferred"]),
      reasoning: z.string().min(5, "Must explain why this match was chosen"),
    })
  ),
  unmatchedSubstances: z.array(
    z.object({
      substanceName: z.string(),
      suggestedActions: z.array(z.string()).describe("What to do with this unmatched substance"),
    })
  ),
});

export type IngredientMatchOutput = z.infer<typeof IngredientMatchSchema>;

// ============================================================================
// Core generation function
// ============================================================================

/**
 * Generate structured output from an LLM call with schema enforcement.
 * Uses Vercel AI SDK generateObject() — the LLM MUST produce valid JSON
 * matching the schema. If it can't, it errors (no silent fallback to free-form).
 */
export async function generateStructuredOutput<T extends z.ZodType>(
  schema: T,
  prompt: string,
  taskType: LlmTaskType,
  options: {
    systemPrompt?: string;
    tenantId?: string;
    maxRetries?: number;
    maxTokens?: number;
  } = {}
): Promise<{ object: z.infer<T>; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
  const {
    systemPrompt,
    tenantId,
    maxRetries = LLM_CONFIG.MAX_RETRIES,
    maxTokens,
  } = options;

  const primaryModelId = getModelIdForTask(taskType);
  const logger = createLlmLogger(primaryModelId, taskType);

  logger.info(
    {
      taskType,
      model: primaryModelId,
      hasSystemPrompt: !!systemPrompt,
      tenantId: tenantId ?? "system",
    },
    "Starting structured LLM generation"
  );

  const startTime = Date.now();

  try {
    const fallbackResult = await executeWithFallback(
      async () => {
        const model = getPrimaryModel(taskType);
        return generateObject({
          model,
          schema,
          prompt,
          system: systemPrompt,
          temperature: getTemperatureForTask(taskType),
          maxRetries,
          maxTokens,
        });
      },
      async () => {
        const fallbackModelId = getFallbackModelIdForTask(taskType);
        logger.warn(
          { fallbackModel: fallbackModelId },
          "Primary model failed, attempting fallback"
        );
        const model = getFallbackModel(taskType);
        return generateObject({
          model,
          schema,
          prompt,
          system: systemPrompt,
          temperature: getTemperatureForTask(taskType),
          maxRetries: 1,
          maxTokens,
        });
      },
      taskType
    );

    const result = fallbackResult.result;
    const latencyMs = Date.now() - startTime;

    // Vercel AI SDK v4 uses inputTokens/outputTokens
    const usage = result.usage;
    const promptTokens = usage.inputTokens ?? 0;
    const completionTokens = usage.outputTokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    const costUsd = calculateLlmCost(primaryModelId, promptTokens, completionTokens);

    await logLlmUsage({
      tenantId: tenantId ?? null,
      model: primaryModelId,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
      taskType,
      success: true,
      latencyMs,
    });

    logger.info(
      {
        taskType,
        model: primaryModelId,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd: costUsd.toFixed(6),
        latencyMs,
        usedFallback: fallbackResult.usedFallback,
      },
      "Structured LLM generation completed"
    );

    return {
      object: result.object as z.infer<T>,
      usage: { promptTokens, completionTokens, totalTokens },
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logLlmUsage({
      tenantId: tenantId ?? null,
      model: primaryModelId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      taskType,
      success: false,
      errorMessage,
      latencyMs,
    });

    logger.error(
      {
        taskType,
        model: primaryModelId,
        error: errorMessage,
        latencyMs,
      },
      "Structured LLM generation failed after fallback"
    );

    if (errorMessage.includes("Could not generate") || errorMessage.includes("Schema validation")) {
      throw new LlmStructuredOutputError(primaryModelId, {
        taskType,
        originalError: errorMessage,
      });
    }

    throw new LlmError(errorMessage, primaryModelId, { taskType });
  }
}
