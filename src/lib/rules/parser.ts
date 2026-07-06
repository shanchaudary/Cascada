// Cascada — Rule Parser
// LLM-based regulatory text parsing orchestrator.
// Takes a RegulatorySource, sends its fullText to the LLM with structured
// output enforcement, and produces Rule + RuleSubstance records in the database.
// This is the core of Stage 3 — the "moat" of the platform.

import { prisma } from "@/lib/db";
import { createLlmLogger } from "@/lib/logger";
import {
  RuleParsingError,
  NotFoundError,
  LlmError,
  LlmStructuredOutputError,
} from "@/lib/errors";
import {
  generateStructuredOutput,
  ParsedRuleSchema,
  type ParsedRuleOutput,
} from "@/lib/llm/structured-output";
import {
  RULE_PARSER_SYSTEM_PROMPT,
  RULE_PARSER_PROMPT_VERSION,
  buildRuleParserPrompt,
  type RuleParserPromptInput,
} from "@/lib/llm/prompts/rule-parser";
import { SUBSTANCE_EXTRACTOR_SYSTEM_PROMPT, buildSubstanceExtractorPrompt } from "@/lib/llm/prompts/substance-extractor";
import { SubstanceExtractionSchema, type SubstanceExtractionOutput } from "@/lib/llm/structured-output";
import { retryWithBackoff, processBatchWithConcurrency } from "@/lib/llm/fallback";
import type { LlmTaskType } from "@/lib/llm/client";

// ============================================================================
// Types
// ============================================================================

export interface RuleParsingResult {
  sourceId: string;
  sourceName: string;
  jurisdiction: string;
  rulesCreated: number;
  substancesCreated: number;
  substancesMatched: number;
  confidence: number;
  parsingVersion: string;
  latencyMs: number;
  usedFallback: boolean;
}

export interface BatchParsingResult {
  totalSources: number;
  successful: number;
  failed: number;
  totalRulesCreated: number;
  totalSubstancesCreated: number;
  results: Array<RuleParsingResult | { sourceId: string; error: string }>;
  totalLatencyMs: number;
}

// ============================================================================
// Single source parsing
// ============================================================================

/**
 * Parse a single RegulatorySource using the LLM.
 *
 * Flow:
 * 1. Load the RegulatorySource from the database
 * 2. Check if it has fullText (required for parsing)
 * 3. Update status to PROCESSING
 * 4. Build the prompt with source context and any previous rules
 * 5. Call generateStructuredOutput with ParsedRuleSchema
 * 6. Create Rule and RuleSubstance records from the parsed output
 * 7. Update the source status to PARSED
 *
 * If parsing fails, update status to DETECTED and store the error.
 */
export async function parseRegulatorySource(
  sourceId: string,
  options: {
    tenantId?: string;
    forceReprocess?: boolean;
  } = {}
): Promise<RuleParsingResult> {
  const logger = createLlmLogger("gpt-4o", "rule_parsing");
  const startTime = Date.now();

  logger.info({ sourceId, forceReprocess: options.forceReprocess }, "Starting rule parsing");

  // 1. Load the source
  const source = await prisma.regulatorySource.findUnique({
    where: { id: sourceId },
    include: {
      rules: {
        include: { substances: true },
        orderBy: { version: "desc" },
      },
    },
  });

  if (!source) {
    throw new NotFoundError("RegulatorySource", sourceId);
  }

  // 2. Check for existing parsed rules
  if (source.rules.length > 0 && !options.forceReprocess) {
    const hasActiveRules = source.rules.some((r) => r.smeValidatedBy !== null);
    if (hasActiveRules && source.status === "PARSED") {
      logger.info(
        { sourceId, existingRules: source.rules.length },
        "Source already parsed with validated rules. Use forceReprocess=true to override."
      );
      return {
        sourceId,
        sourceName: source.name,
        jurisdiction: source.jurisdiction,
        rulesCreated: 0,
        substancesCreated: 0,
        substancesMatched: 0,
        confidence: 1,
        parsingVersion: RULE_PARSER_PROMPT_VERSION,
        latencyMs: Date.now() - startTime,
        usedFallback: false,
      };
    }
  }

  // 3. Check for fullText
  if (!source.fullText || source.fullText.trim().length < 50) {
    throw new RuleParsingError(
      sourceId,
      "Source does not have sufficient text for parsing (minimum 50 characters required)",
      { fullTextLength: source.fullText?.length ?? 0 }
    );
  }

  // 4. Update status to PROCESSING
  await prisma.regulatorySource.update({
    where: { id: sourceId },
    data: {
      status: "PROCESSING",
      processedAt: new Date(),
      processingError: null,
    },
  });

  try {
    // 5. Build the prompt
    const promptInput: RuleParserPromptInput = {
      sourceName: source.name,
      sourceType: source.sourceType,
      jurisdiction: source.jurisdiction,
      fullText: source.fullText,
      previousRules: source.rules.map((r) => ({
        ruleType: r.ruleType,
        description: r.description,
        version: r.version,
      })),
    };

    const prompt = buildRuleParserPrompt(promptInput);

    // 6. Call the LLM with structured output
    const parsedResult = await retryWithBackoff(
      () => generateStructuredOutput(
        ParsedRuleSchema,
        prompt,
        "rule_parsing" as LlmTaskType,
        {
          systemPrompt: RULE_PARSER_SYSTEM_PROMPT,
          tenantId: options.tenantId,
          maxRetries: 2,
        }
      ),
      { taskType: "rule_parsing" as LlmTaskType, maxRetries: 1 }
    );

    const parsed: ParsedRuleOutput = parsedResult.object;

    logger.info(
      {
        sourceId,
        rulesExtracted: parsed.rules.length,
        confidence: parsed.confidence,
        jurisdictionConfirmed: parsed.jurisdictionConfirmed,
      },
      "LLM parsing completed"
    );

    // 7. Create Rule and RuleSubstance records
    let rulesCreated = 0;
    let substancesCreated = 0;

    for (const ruleData of parsed.rules) {
      const rule = await prisma.rule.create({
        data: {
          sourceId: source.id,
          jurisdiction: parsed.jurisdictionConfirmed,
          ruleType: ruleData.ruleType,
          description: ruleData.description,
          effectiveDate: ruleData.effectiveDate ? new Date(ruleData.effectiveDate) : null,
          complianceDate: ruleData.complianceDate ? new Date(ruleData.complianceDate) : null,
          gracePeriodDays: ruleData.gracePeriodDays,
          penaltyType: ruleData.penaltyType,
          penaltyAmount: ruleData.penaltyAmount,
          exemptions: ruleData.exemptions.length > 0 ? (ruleData.exemptions ) : undefined,
          notes: `Parsed by LLM v${RULE_PARSER_PROMPT_VERSION}. Confidence: ${parsed.confidence}. Summary: ${parsed.summary}`,
        },
      });

      rulesCreated++;

      // Create RuleSubstance records
      for (const substanceData of ruleData.substances) {
        await prisma.ruleSubstance.create({
          data: {
            ruleId: rule.id,
            substanceName: substanceData.substanceName,
            substanceType: substanceData.substanceType,
            casNumber: substanceData.casNumber,
            eenumber: substanceData.eenumber,
            threshold: substanceData.threshold ? substanceData.threshold : null,
            thresholdUnit: substanceData.thresholdUnit,
            productScope: substanceData.productScope ? (substanceData.productScope ) : undefined,
            isMatched: false,
            matchConfidence: null,
            matchMethod: null,
          },
        });
        substancesCreated++;
      }
    }

    // 8. Update source status to PARSED
    await prisma.regulatorySource.update({
      where: { id: sourceId },
      data: {
        status: "PARSED",
        processedAt: new Date(),
        processingError: null,
      },
    });

    const latencyMs = Date.now() - startTime;

    logger.info(
      {
        sourceId,
        rulesCreated,
        substancesCreated,
        confidence: parsed.confidence,
        latencyMs,
      },
      "Rule parsing completed successfully"
    );

    return {
      sourceId,
      sourceName: source.name,
      jurisdiction: parsed.jurisdictionConfirmed,
      rulesCreated,
      substancesCreated,
      substancesMatched: 0,
      confidence: parsed.confidence,
      parsingVersion: RULE_PARSER_PROMPT_VERSION,
      latencyMs,
      usedFallback: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Update source with error
    await prisma.regulatorySource.update({
      where: { id: sourceId },
      data: {
        status: "DETECTED", // Reset to DETECTED so it can be retried
        processingError: errorMessage,
      },
    });

    logger.error(
      { sourceId, error: errorMessage },
      "Rule parsing failed"
    );

    throw new RuleParsingError(sourceId, errorMessage, {
      originalError: error instanceof Error ? error.constructor.name : "Unknown",
    });
  }
}

// ============================================================================
// Substance enrichment (secondary LLM pass)
// ============================================================================

/**
 * Enrich substances from a parsed rule with additional data from the LLM.
 * This is a second-pass analysis that adds aliases, health concerns, etc.
 */
export async function enrichSubstances(
  sourceId: string,
  options: {
    tenantId?: string;
  } = {}
): Promise<{ enriched: number; total: number }> {
  const logger = createLlmLogger("gpt-4o", "substance_extraction");

  const source = await prisma.regulatorySource.findUnique({
    where: { id: sourceId },
    include: {
      rules: {
        include: { substances: true },
      },
    },
  });

  if (!source) {
    throw new NotFoundError("RegulatorySource", sourceId);
  }

  if (!source.fullText) {
    return { enriched: 0, total: 0 };
  }

  const allSubstances = source.rules.flatMap((r) => r.substances);
  if (allSubstances.length === 0) {
    return { enriched: 0, total: 0 };
  }

  logger.info(
    { sourceId, substanceCount: allSubstances.length },
    "Starting substance enrichment"
  );

  const prompt = buildSubstanceExtractorPrompt({
    sourceName: source.name,
    fullText: source.fullText,
    existingSubstances: allSubstances.map((s) => ({
      substanceName: s.substanceName,
      substanceType: s.substanceType,
      casNumber: s.casNumber,
      eenumber: s.eenumber,
    })),
  });

  const result = await generateStructuredOutput(
    SubstanceExtractionSchema,
    prompt,
    "substance_extraction" as LlmTaskType,
    {
      systemPrompt: SUBSTANCE_EXTRACTOR_SYSTEM_PROMPT,
      tenantId: options.tenantId,
    }
  );

  const enriched: SubstanceExtractionOutput = result.object;

  // Update RuleSubstance records with enriched data
  let updated = 0;
  for (const enrichedSub of enriched.substances) {
    // Find matching RuleSubstance by name or CAS number
    const match = allSubstances.find(
      (s) =>
        s.substanceName.toLowerCase() === enrichedSub.substanceName.toLowerCase() ||
        (s.casNumber && enrichedSub.casNumber && s.casNumber === enrichedSub.casNumber)
    );

    if (match) {
      // Update with enriched aliases stored in metadata
      const existingScope = Array.isArray(match.productScope) ? match.productScope as string[] : [];
      const updatedScope = enrichedSub.productScope
        ? [...existingScope, ...enrichedSub.productScope]
        : existingScope;
      await prisma.ruleSubstance.update({
        where: { id: match.id },
        data: {
          productScope: updatedScope.length > 0 ? updatedScope : undefined,
        },
      });
      updated++;
    }
  }

  logger.info(
    { sourceId, enriched: updated, total: allSubstances.length },
    "Substance enrichment completed"
  );

  return { enriched: updated, total: allSubstances.length };
}

// ============================================================================
// Batch parsing
// ============================================================================

/**
 * Parse multiple regulatory sources in batch.
 * Uses concurrency control to avoid overwhelming the LLM API.
 */
export async function batchParseSources(
  sourceIds: string[],
  options: {
    tenantId?: string;
    concurrency?: number;
    forceReprocess?: boolean;
  } = {}
): Promise<BatchParsingResult> {
  const startTime = Date.now();

  const results = await processBatchWithConcurrency(
    sourceIds,
    async (sourceId) => {
      return parseRegulatorySource(sourceId, {
        tenantId: options.tenantId,
        forceReprocess: options.forceReprocess,
      });
    },
    {
      concurrency: options.concurrency ?? 2,
      taskType: "rule_parsing" as LlmTaskType,
    }
  );

  const successful = results.filter((r) => r.result !== null);
  const failed = results.filter((r) => r.error !== null);

  return {
    totalSources: sourceIds.length,
    successful: successful.length,
    failed: failed.length,
    totalRulesCreated: successful.reduce(
      (sum, r) => sum + (r.result?.rulesCreated ?? 0),
      0
    ),
    totalSubstancesCreated: successful.reduce(
      (sum, r) => sum + (r.result?.substancesCreated ?? 0),
      0
    ),
    results: results.map((r) =>
      r.result
        ? r.result
        : { sourceId: r.item, error: r.error?.message ?? "Unknown error" }
    ),
    totalLatencyMs: Date.now() - startTime,
  };
}
