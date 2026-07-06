// Cascada — Substance Matcher
// Matches RuleSubstance records to tenant Ingredient records.
// Uses a multi-strategy matching algorithm:
//   1. Exact name match
//   2. Alternate name (alias) match
//   3. CAS number match
//   4. E-number match
//   5. LLM-inferred match (with lower confidence)
//   6. Manual match (SME review)
//
// This is critical for cascade analysis — without ingredient matching,
// we can't trace regulatory changes through formulations and products.

import { prisma } from "@/lib/db";
import { createLlmLogger } from "@/lib/logger";
import { generateStructuredOutput, IngredientMatchSchema, type IngredientMatchOutput } from "@/lib/llm/structured-output";
import type { LlmTaskType } from "@/lib/llm/client";
import type { SubstanceMatch, SubstanceMatchResult } from "@/types/regulatory";

// ============================================================================
// Types
// ============================================================================

export interface SubstanceMatcherInput {
  ruleSubstances: Array<{
    id: string;
    substanceName: string;
    substanceType: string;
    casNumber: string | null;
    eenumber: string | null;
  }>;
  tenantIngredients: Array<{
    id: string;
    name: string;
    alternateNames: string[];
    casNumber: string | null;
    eenumber: string | null;
    category: string | null;
  }>;
}

export interface MatchResult {
  ruleSubstanceId: string;
  ingredientId: string | null;
  confidence: number;
  method: SubstanceMatch["method"];
  reasoning: string;
}

// ============================================================================
// Deterministic matching (no LLM required)
// ============================================================================

/**
 * Attempt to match substances using deterministic methods.
 * These are fast, free, and highly accurate.
 * Returns matches with their confidence and method.
 */
export function matchSubstancesDeterministic(
  input: SubstanceMatcherInput
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const substance of input.ruleSubstances) {
    const matches: Array<{
      ingredientId: string;
      confidence: number;
      method: MatchResult["method"];
      reasoning: string;
    }> = [];

    for (const ingredient of input.tenantIngredients) {
      // Strategy 1: Exact name match (case-insensitive)
      if (substance.substanceName.toLowerCase() === ingredient.name.toLowerCase()) {
        matches.push({
          ingredientId: ingredient.id,
          confidence: 1.0,
          method: "exact",
          reasoning: `Exact name match: "${substance.substanceName}" = "${ingredient.name}"`,
        });
        continue; // Exact match found, skip other strategies for this ingredient
      }

      // Strategy 2: Alternate name match
      const aliasMatch = ingredient.alternateNames.some(
        (alias) => alias.toLowerCase() === substance.substanceName.toLowerCase()
      );
      if (aliasMatch) {
        matches.push({
          ingredientId: ingredient.id,
          confidence: 0.95,
          method: "alias",
          reasoning: `Alias match: "${substance.substanceName}" found in alternate names of "${ingredient.name}"`,
        });
        continue;
      }

      // Strategy 3: CAS number match
      if (
        substance.casNumber &&
        ingredient.casNumber &&
        substance.casNumber === ingredient.casNumber
      ) {
        matches.push({
          ingredientId: ingredient.id,
          confidence: 0.95,
          method: "cas_number",
          reasoning: `CAS number match: ${substance.casNumber} → "${ingredient.name}"`,
        });
        continue;
      }

      // Strategy 4: E-number match
      if (
        substance.eenumber &&
        ingredient.eenumber &&
        substance.eenumber === ingredient.eenumber
      ) {
        matches.push({
          ingredientId: ingredient.id,
          confidence: 0.95,
          method: "eenumber",
          reasoning: `E-number match: E${substance.eenumber} → "${ingredient.name}"`,
        });
        continue;
      }

      // Strategy 5: Partial name match (contained within)
      const subNameLower = substance.substanceName.toLowerCase();
      const ingNameLower = ingredient.name.toLowerCase();
      if (
        subNameLower.length > 3 &&
        (ingNameLower.includes(subNameLower) || subNameLower.includes(ingNameLower))
      ) {
        matches.push({
          ingredientId: ingredient.id,
          confidence: 0.7,
          method: "alias",
          reasoning: `Partial name match: "${substance.substanceName}" ~ "${ingredient.name}"`,
        });
      }
    }

    // Select the best match (highest confidence)
    if (matches.length > 0) {
      const bestMatch = matches.reduce((best, m) =>
        m.confidence > best.confidence ? m : best
      );
      results.push({
        ruleSubstanceId: substance.id,
        ingredientId: bestMatch.ingredientId,
        confidence: bestMatch.confidence,
        method: bestMatch.method,
        reasoning: bestMatch.reasoning,
      });
    } else {
      results.push({
        ruleSubstanceId: substance.id,
        ingredientId: null,
        confidence: 0,
        method: "exact",
        reasoning: `No deterministic match found for "${substance.substanceName}"`,
      });
    }
  }

  return results;
}

// ============================================================================
// LLM-assisted matching
// ============================================================================

const LLM_MATCH_SYSTEM_PROMPT = `You are a food chemistry expert matching regulatory substances to a company's ingredient catalog.

For each substance, find the best matching ingredient from the catalog. Consider:
- Chemical identity (same compound even if different names)
- CAS number cross-references
- E-number cross-references
- Common trade names and synonyms
- Functional equivalence (same purpose even if different chemical)

If no match exists, set matchedIngredientId to null and suggest actions.

Output valid JSON matching the schema.` as const;

/**
 * Use the LLM to match unmatched substances to ingredients.
 * Only called for substances where deterministic matching failed.
 * Uses a more creative temperature but still produces structured output.
 */
export async function matchSubstancesWithLlm(
  unmatchedSubstances: Array<{
    id: string;
    substanceName: string;
    substanceType: string;
    casNumber: string | null;
    eenumber: string | null;
  }>,
  tenantIngredients: Array<{
    id: string;
    name: string;
    alternateNames: string[];
    casNumber: string | null;
    eenumber: string | null;
    category: string | null;
  }>,
  options: {
    tenantId?: string;
  } = {}
): Promise<MatchResult[]> {
  const logger = createLlmLogger("gpt-4o-mini", "ingredient_matching");

  if (unmatchedSubstances.length === 0) {
    return [];
  }

  logger.info(
    { unmatchedCount: unmatchedSubstances.length, ingredientCount: tenantIngredients.length },
    "Starting LLM-assisted substance matching"
  );

  // Build the prompt
  const substanceList = unmatchedSubstances
    .map((s) => `- ID: ${s.id}, Name: "${s.substanceName}" (${s.substanceType})${s.casNumber ? `, CAS: ${s.casNumber}` : ""}${s.eenumber ? `, E${s.eenumber}` : ""}`)
    .join("\n");

  const ingredientCatalog = tenantIngredients
    .map((i) => `- ID: ${i.id}, Name: "${i.name}"${i.casNumber ? `, CAS: ${i.casNumber}` : ""}${i.eenumber ? `, E${i.eenumber}` : ""}${i.category ? `, Category: ${i.category}` : ""}${i.alternateNames.length > 0 ? `, Aliases: [${i.alternateNames.map((a) => `"${a}"`).join(", ")}]` : ""}`)
    .join("\n");

  const prompt = `## Unmatched Substances
${substanceList}

## Ingredient Catalog
${ingredientCatalog}

## Task
Match each unmatched substance to the best ingredient in the catalog. If no match exists, set the match to null and suggest what actions to take (e.g., "Add to ingredient catalog", "Check with R&D team").`;

  const result = await generateStructuredOutput(
    IngredientMatchSchema,
    prompt,
    "ingredient_matching" as LlmTaskType,
    {
      systemPrompt: LLM_MATCH_SYSTEM_PROMPT,
      tenantId: options.tenantId,
    }
  );

  const matched: IngredientMatchOutput = result.object;

  return matched.matches.map((m) => ({
    ruleSubstanceId: m.substanceName, // The LLM uses substance name, we map back
    ingredientId: m.matchedIngredientId,
    confidence: m.confidence,
    method: m.method,
    reasoning: m.reasoning,
  }));
}

// ============================================================================
// Full matching pipeline
// ============================================================================

/**
 * Execute the complete substance matching pipeline for a tenant's unmatched RuleSubstances.
 *
 * 1. Load all unmatched RuleSubstances
 * 2. Load the tenant's ingredient catalog
 * 3. Run deterministic matching
 * 4. For unmatched substances, run LLM matching
 * 5. Update RuleSubstance records with match results
 */
export async function matchAllSubstances(
  tenantId: string,
  options: {
    useLlm?: boolean;
    minConfidence?: number;
  } = {}
): Promise<SubstanceMatchResult> {
  const logger = createLlmLogger("system", "ingredient_matching");
  const { useLlm = true, minConfidence = 0.7 } = options;

  logger.info({ tenantId, useLlm, minConfidence }, "Starting full substance matching");

  // Load unmatched substances from rules related to the tenant's regulatory sources
  const unmatchedSubstances = await prisma.ruleSubstance.findMany({
    where: {
      isMatched: false,
    },
    include: {
      rule: {
        include: {
          source: true,
        },
      },
    },
  });

  // Load tenant's ingredient catalog
  const ingredients = await prisma.ingredient.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      alternateNames: true,
      casNumber: true,
      eenumber: true,
      category: true,
    },
  });

  if (unmatchedSubstances.length === 0 || ingredients.length === 0) {
    return {
      totalSubstances: unmatchedSubstances.length,
      matched: 0,
      unmatched: unmatchedSubstances.length,
      lowConfidence: 0,
      matches: [],
      unmatchedSubstances: unmatchedSubstances.map((s) => ({
        substanceName: s.substanceName,
        casNumber: s.casNumber,
        eenumber: s.eenumber,
      })),
    };
  }

  // Step 1: Deterministic matching
  const deterministicResults = matchSubstancesDeterministic({
    ruleSubstances: unmatchedSubstances.map((s) => ({
      id: s.id,
      substanceName: s.substanceName,
      substanceType: s.substanceType,
      casNumber: s.casNumber,
      eenumber: s.eenumber,
    })),
    tenantIngredients: ingredients,
  });

  // Step 2: Update matched substances in the database
  let matchedCount = 0;
  let lowConfidenceCount = 0;

  for (const result of deterministicResults) {
    if (result.ingredientId && result.confidence >= minConfidence) {
      await prisma.ruleSubstance.update({
        where: { id: result.ruleSubstanceId },
        data: {
          ingredientId: result.ingredientId,
          isMatched: true,
          matchConfidence: result.confidence,
          matchMethod: result.method,
        },
      });
      matchedCount++;
    } else if (result.ingredientId && result.confidence < minConfidence) {
      // Store low-confidence match but don't mark as matched
      await prisma.ruleSubstance.update({
        where: { id: result.ruleSubstanceId },
        data: {
          ingredientId: result.ingredientId,
          matchConfidence: result.confidence,
          matchMethod: result.method,
        },
      });
      lowConfidenceCount++;
    }
  }

  // Step 3: LLM matching for still-unmatched substances
  const stillUnmatched = unmatchedSubstances.filter(
    (s) => {
      const result = deterministicResults.find((r) => r.ruleSubstanceId === s.id);
      return !result?.ingredientId;
    }
  );

  if (useLlm && stillUnmatched.length > 0) {
    try {
      const llmResults = await matchSubstancesWithLlm(
        stillUnmatched.map((s) => ({
          id: s.id,
          substanceName: s.substanceName,
          substanceType: s.substanceType,
          casNumber: s.casNumber,
          eenumber: s.eenumber,
        })),
        ingredients,
        { tenantId }
      );

      for (const result of llmResults) {
        if (result.ingredientId && result.confidence >= minConfidence) {
          await prisma.ruleSubstance.update({
            where: { id: result.ruleSubstanceId },
            data: {
              ingredientId: result.ingredientId,
              isMatched: true,
              matchConfidence: result.confidence,
              matchMethod: "llm_inferred",
            },
          });
          matchedCount++;
        }
      }
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "LLM matching failed, continuing with deterministic results only"
      );
    }
  }

  // Build final result
  const finalUnmatched = await prisma.ruleSubstance.findMany({
    where: {
      isMatched: false,
      id: { in: unmatchedSubstances.map((s) => s.id) },
    },
  });

  return {
    totalSubstances: unmatchedSubstances.length,
    matched: matchedCount,
    unmatched: finalUnmatched.length,
    lowConfidence: lowConfidenceCount,
    matches: deterministicResults.map((r) => ({
      ruleSubstanceId: r.ruleSubstanceId,
      ingredientId: r.ingredientId,
      confidence: r.confidence,
      method: r.method,
      reasoning: r.reasoning,
    })),
    unmatchedSubstances: finalUnmatched.map((s) => ({
      substanceName: s.substanceName,
      casNumber: s.casNumber,
      eenumber: s.eenumber,
    })),
  };
}
