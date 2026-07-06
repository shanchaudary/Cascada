// Cascada — Rule Builder
// Constructs Rule + RuleSubstance records from parsed LLM output.
// Handles deduplication, version incrementing, and cross-referencing.
// Called by the parser after LLM extraction succeeds.

import { prisma } from "@/lib/db";
import { createLlmLogger } from "@/lib/logger";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { RuleType } from "@prisma/client";
import type { ParsedRuleOutput } from "@/lib/llm/structured-output";

// ============================================================================
// Types
// ============================================================================

export interface RuleBuildResult {
  ruleId: string;
  ruleVersion: number;
  substanceCount: number;
  isNewRule: boolean;
  supersededRuleId: string | null;
}

export interface BulkBuildResult {
  totalRules: number;
  newRules: number;
  updatedRules: number;
  totalSubstances: number;
  results: RuleBuildResult[];
}

// ============================================================================
// Single rule construction
// ============================================================================

/**
 * Build a single Rule record from parsed data.
 * Handles:
 * - Version incrementing if a previous version exists
 * - Linking to previous version via previousVersionId
 * - Creating all RuleSubstance records
 * - Setting superseded status on old versions
 */
export async function buildRule(
  sourceId: string,
  ruleData: ParsedRuleOutput["rules"][number],
  parsedMeta: {
    jurisdiction: string;
    confidence: number;
    promptVersion: string;
  }
): Promise<RuleBuildResult> {
  const logger = createLlmLogger("system", "rule-builder");

  // Check for existing rules of the same type from the same source
  const existingRules = await prisma.rule.findMany({
    where: {
      sourceId,
      ruleType: ruleData.ruleType as RuleType,
    },
    orderBy: { version: "desc" },
  });

  const latestVersion = existingRules.length > 0 ? existingRules[0] : null;
  const newVersion = latestVersion ? latestVersion.version + 1 : 1;

  logger.info(
    {
      sourceId,
      ruleType: ruleData.ruleType,
      newVersion,
      hasPrevious: !!latestVersion,
    },
    "Building rule record"
  );

  // Create the new rule
  const rule = await prisma.rule.create({
    data: {
      sourceId,
      version: newVersion,
      previousVersionId: latestVersion?.id ?? null,
      jurisdiction: parsedMeta.jurisdiction,
      ruleType: ruleData.ruleType as RuleType,
      description: ruleData.description,
      effectiveDate: ruleData.effectiveDate ? new Date(ruleData.effectiveDate) : null,
      complianceDate: ruleData.complianceDate ? new Date(ruleData.complianceDate) : null,
      gracePeriodDays: ruleData.gracePeriodDays,
      penaltyType: ruleData.penaltyType,
      penaltyAmount: ruleData.penaltyAmount,
      exemptions: ruleData.exemptions.length > 0 ? (ruleData.exemptions ) : undefined,
      notes: `Parsed by LLM v${parsedMeta.promptVersion}. Confidence: ${parsedMeta.confidence}.`,
    },
  });

  // Create RuleSubstance records
  let substanceCount = 0;
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
    substanceCount++;
  }

  // If this is an updated version, we don't auto-supersede — SME must validate
  // But we do note the relationship via previousVersionId

  return {
    ruleId: rule.id,
    ruleVersion: newVersion,
    substanceCount,
    isNewRule: !latestVersion,
    supersededRuleId: null, // Superseding happens in versioning.ts after SME approval
  };
}

// ============================================================================
// Bulk rule construction
// ============================================================================

/**
 * Build all rules from a parsed LLM output.
 * Called by the parser after a successful extraction.
 */
export async function buildRulesFromParsed(
  sourceId: string,
  parsed: ParsedRuleOutput,
  promptVersion: string
): Promise<BulkBuildResult> {
  const logger = createLlmLogger("system", "rule-builder");
  const results: RuleBuildResult[] = [];

  logger.info(
    {
      sourceId,
      ruleCount: parsed.rules.length,
      jurisdiction: parsed.jurisdictionConfirmed,
    },
    "Building all rules from parsed output"
  );

  for (const ruleData of parsed.rules) {
    const result = await buildRule(sourceId, ruleData, {
      jurisdiction: parsed.jurisdictionConfirmed,
      confidence: parsed.confidence,
      promptVersion,
    });
    results.push(result);
  }

  const newRules = results.filter((r) => r.isNewRule).length;
  const updatedRules = results.filter((r) => !r.isNewRule).length;
  const totalSubstances = results.reduce((sum, r) => sum + r.substanceCount, 0);

  return {
    totalRules: results.length,
    newRules,
    updatedRules,
    totalSubstances,
    results,
  };
}

// ============================================================================
// Rule deduplication
// ============================================================================

/**
 * Check if a rule with the same substance and type already exists for this source.
 * Prevents creating duplicate rules when the same source is parsed multiple times.
 */
export async function checkRuleDuplicate(
  sourceId: string,
  ruleType: RuleType,
  substanceNames: string[]
): Promise<{ isDuplicate: boolean; existingRuleId: string | null }> {
  if (substanceNames.length === 0) {
    return { isDuplicate: false, existingRuleId: null };
  }

  // Find rules from this source with the same type
  const existingRules = await prisma.rule.findMany({
    where: {
      sourceId,
      ruleType,
    },
    include: {
      substances: true,
    },
  });

  for (const existing of existingRules) {
    const existingNames = existing.substances.map((s) => s.substanceName.toLowerCase());
    const newNames = substanceNames.map((n) => n.toLowerCase());

    // Check if substance lists overlap significantly (>80% match)
    const overlap = newNames.filter((n) => existingNames.includes(n)).length;
    const overlapRatio = overlap / Math.max(newNames.length, existingNames.length);

    if (overlapRatio >= 0.8) {
      return { isDuplicate: true, existingRuleId: existing.id };
    }
  }

  return { isDuplicate: false, existingRuleId: null };
}

// ============================================================================
// Rule with ingredient cross-reference
// ============================================================================

/**
 * Get a rule with its substances and matched ingredients.
 * Used in the cascade engine to trace from regulation → ingredient → formulation.
 */
export async function getRuleWithIngredients(ruleId: string) {
  const rule = await prisma.rule.findUnique({
    where: { id: ruleId },
    include: {
      source: true,
      substances: {
        include: {
          ingredient: {
            include: {
              formulationItems: {
                include: {
                  formulation: {
                    include: {
                      products: {
                        include: {
                          product: {
                            include: {
                              customerProducts: {
                                include: {
                                  customer: true,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              ruleSubstances: true,
              substitutionOptions: {
                include: {
                  substituteIngredient: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!rule) {
    throw new NotFoundError("Rule", ruleId);
  }

  return rule;
}

/**
 * Get all rules that affect a specific tenant's ingredients.
 * This is the entry point for cascade analysis — find which regulations
 * touch which of the tenant's ingredients.
 */
export async function getRulesAffectingTenant(tenantId: string) {
  // Get the tenant's ingredient IDs
  const ingredients = await prisma.ingredient.findMany({
    where: { tenantId },
    select: { id: true },
  });

  const ingredientIds = ingredients.map((i) => i.id);

  if (ingredientIds.length === 0) {
    return [];
  }

  // Find all RuleSubstances that match the tenant's ingredients
  const matchedSubstances = await prisma.ruleSubstance.findMany({
    where: {
      ingredientId: { in: ingredientIds },
      isMatched: true,
    },
    include: {
      rule: {
        include: {
          source: true,
          substances: {
            where: { isMatched: true },
            include: {
              ingredient: true,
            },
          },
          cascadeTriggers: true,
        },
      },
      ingredient: true,
    },
  });

  // Deduplicate rules
  const seenRuleIds = new Set<string>();
  const uniqueRules = matchedSubstances
    .map((s) => s.rule)
    .filter((r) => {
      if (seenRuleIds.has(r.id)) return false;
      seenRuleIds.add(r.id);
      return true;
    });

  return uniqueRules;
}
