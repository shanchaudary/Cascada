// Cascada — Reformulation Advisor Agent
// Suggests reformulation alternatives for ingredients that are banned, restricted,
// or under regulatory pressure. Combines existing catalog substitutes with AI-generated
// suggestions, providing feasibility scores, sensory impact, cost deltas, and
// regulatory risk assessments.
//
// Uses the reformulation-advisor prompt template from Stage 3 and extends it with
// real database lookups, substitution analysis, and cost estimation.

import { generateObject } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getPrimaryModel,
  getFallbackModel,
  getTemperatureForTask,
  calculateLlmCost,
} from "@/lib/llm/client";
import { logLlmUsage } from "@/lib/llm/cost-tracker";
import { executeWithFallback } from "@/lib/llm/fallback";
import {
  REFORMULATION_ADVISOR_SYSTEM_PROMPT,
  buildReformulationAdvisorPrompt,
} from "@/lib/llm/prompts/reformulation-advisor";
import { generateStructuredOutput } from "@/lib/llm/structured-output";
import { createAgentLogger } from "@/lib/logger";
import { AgentError, AgentPlanAccessError, AgentBudgetError } from "@/lib/errors";
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentMessage,
  ReformulationInput,
  ReformulationResult,
  ReformulationSubstitute,
  RAGContext,
} from "./types";
import { AGENT_CONFIG } from "./types";
import { buildAgentContext, serializeContextForPrompt } from "./context";
import { getAvailableTools, formatToolDefinitionsForPrompt } from "./tools";

// ============================================================================
// Reformulation Output Schema (for LLM structured output)
// ============================================================================

export const ReformulationOutputSchema = z.object({
  substitutes: z.array(
    z.object({
      ingredientName: z.string().describe("Name of the substitute ingredient"),
      casNumber: z.string().nullable().describe("CAS number if known"),
      eenumber: z.string().nullable().describe("E-number if known"),
      category: z.string().nullable().describe("Functional category (e.g., 'natural dye', 'preservative')"),
      feasibilityScore: z.number().min(0).max(1).describe("Feasibility score 0-1"),
      sensoryImpact: z.enum(["none", "minor", "moderate", "significant"]).describe("Expected sensory impact"),
      shelfLifeImpact: z.string().describe("Expected shelf life impact description"),
      regulatoryRisk: z.enum(["none", "review_needed", "restricted_in_some_jurisdictions"]).describe("Regulatory risk of the substitute"),
      costDeltaPerUnit: z.number().nullable().describe("Per-unit cost increase (positive) or decrease (negative) in USD"),
      implementationTimelineDays: z.number().nullable().describe("Estimated days to validate and deploy"),
      source: z.enum(["ai_suggestion", "existing_catalog", "supplier_recommended"]).describe("Source of this suggestion"),
      reasoning: z.string().min(10, "Must provide reasoning for this substitution"),
      applicableProducts: z.array(z.string()).describe("Product names this substitute would work for"),
      allergenFlags: z.array(z.string()).describe("Allergen flags for the substitute"),
    })
  ).min(1, "At least one substitute must be suggested"),
  recommendation: z.object({
    bestSubstitute: z.string().nullable().describe("Name of the best overall substitute, or null if none suitable"),
    reasoning: z.string().min(10, "Must explain the recommendation"),
    estimatedTotalCost: z.number().nullable().describe("Total estimated cost across all affected products"),
    estimatedTimelineDays: z.number().nullable().describe("Estimated days to implement across all products"),
  }),
});

export type ReformulationOutput = z.infer<typeof ReformulationOutputSchema>;

// ============================================================================
// Main Agent Execution
// ============================================================================

/**
 * Execute the Reformulation Advisor Agent.
 * Takes an ingredient ID, retrieves context, and generates reformulation suggestions
 * with structured output from the LLM.
 */
export async function executeReformulationAgent(
  input: ReformulationInput,
  context: AgentExecutionContext
): Promise<ReformulationResult> {
  const logger = createAgentLogger("reformulation", "execute");
  const startTime = Date.now();

  // 1. Plan access check
  const allowedAgents = AGENT_CONFIG.AGENT_PLAN_ACCESS[context.plan];
  if (!allowedAgents.includes("reformulation")) {
    throw new AgentPlanAccessError("reformulation", context.plan);
  }

  // 2. Budget check
  const budget = await checkLlmBudget(context.tenantId, context.plan);
  if (!budget.allowed) {
    throw new AgentBudgetError("reformulation", context.tenantId, budget.remaining);
  }

  logger.info(
    {
      tenantId: context.tenantId,
      userId: context.userId,
      ingredientId: input.ingredientId,
      triggerId: input.triggerId,
      focusProductCount: input.focusProductIds?.length ?? 0,
      includeAiSuggestions: input.includeAiSuggestions,
    },
    "Reformulation advisor agent starting"
  );

  // 3. Get the ingredient details
  const ingredient = await prisma.ingredient.findUnique({
    where: { id: input.ingredientId, tenantId: context.tenantId },
    include: {
      substitutionOptions: {
        include: {
          substituteIngredient: {
            select: {
              id: true,
              name: true,
              casNumber: true,
              eenumber: true,
              category: true,
              allergenFlags: true,
              isSynthetic: true,
              sourceType: true,
            },
          },
        },
        take: 10,
      },
      formulationItems: {
        take: 30,
        include: {
          formulation: {
            include: {
              products: {
                where: { isCurrent: true },
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      sku: true,
                      category: true,
                      annualVolume: true,
                      annualRevenue: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!ingredient) {
    throw new AgentError(
      `Ingredient ${input.ingredientId} not found for tenant`,
      "reformulation",
      { tenantId: context.tenantId, ingredientId: input.ingredientId }
    );
  }

  // 4. Build RAG context focused on this ingredient
  const ragContext = await buildAgentContext({
    tenantId: context.tenantId,
    agentType: "reformulation",
    focusIngredientId: [input.ingredientId],
    focusTriggerIds: input.triggerId ? [input.triggerId] : undefined,
    focusProductIds: input.focusProductIds,
  });

  // 5. Build the affected products list
  const affectedProducts: Array<{
    name: string;
    sku: string;
    category: string;
    formulation: string;
    concentrationPercentage: number | null;
  }> = [];

  for (const fi of ingredient.formulationItems) {
    for (const pf of fi.formulation.products) {
      if (input.focusProductIds && !input.focusProductIds.includes(pf.product.id)) continue;
      affectedProducts.push({
        name: pf.product.name,
        sku: pf.product.sku,
        category: pf.product.category ?? "",
        formulation: fi.formulation.name,
        concentrationPercentage: fi.percentage ? Number(fi.percentage) : null,
      });
    }
  }

  // 6. Get regulatory context if a trigger is specified
  let regulatoryContext: {
    regulationName: string;
    jurisdiction: string;
    ruleType: string;
    deadline: string | null;
    threshold: number | null;
    thresholdUnit: string | null;
  } | null = null;

  if (input.triggerId) {
    const trigger = await prisma.cascadeTrigger.findUnique({
      where: { id: input.triggerId },
      include: {
        rule: {
          include: {
            source: { select: { name: true, jurisdiction: true } },
            substances: {
              where: { ingredientId: input.ingredientId },
              take: 1,
            },
          },
        },
      },
    });

    if (trigger) {
      const substance = trigger.rule.substances[0];
      regulatoryContext = {
        regulationName: trigger.rule.source.name,
        jurisdiction: trigger.rule.source.jurisdiction,
        ruleType: trigger.rule.ruleType,
        deadline: trigger.rule.complianceDate?.toISOString() ?? null,
        threshold: substance?.threshold ? Number(substance.threshold) : null,
        thresholdUnit: substance?.thresholdUnit ?? null,
      };
    }
  }

  // If no specific trigger, use the first relevant regulation from context
  if (!regulatoryContext && ragContext.regulations.length > 0) {
    const reg = ragContext.regulations[0]!;
    regulatoryContext = {
      regulationName: reg.name,
      jurisdiction: reg.jurisdiction,
      ruleType: reg.ruleType,
      deadline: reg.complianceDate,
      threshold: reg.substances[0]?.threshold ?? null,
      thresholdUnit: reg.substances[0]?.thresholdUnit ?? null,
    };
  }

  // 7. Get candidate substitutes from the tenant's catalog
  const candidateSubstitutes = await findCandidateSubstitutes(
    context.tenantId,
    ingredient,
    input.includeAiSuggestions
  );

  // 8. Build the reformulation prompt
  const reformPrompt = buildReformulationAdvisorPrompt({
    originalIngredient: {
      name: ingredient.name,
      casNumber: ingredient.casNumber,
      eenumber: ingredient.eenumber,
      category: ingredient.category,
      functionalRole: ingredient.category, // Use category as functional role
    },
    regulatoryContext: regulatoryContext ?? {
      regulationName: "General regulatory pressure",
      jurisdiction: "US",
      ruleType: "INGREDIENT_REVIEW",
      deadline: null,
      threshold: null,
      thresholdUnit: null,
    },
    affectedProducts,
    existingSubstitutions: ingredient.substitutionOptions.map((s) => ({
      substituteName: s.substituteIngredient.name,
      feasibilityScore: s.feasibilityScore ? Number(s.feasibilityScore) : null,
      source: s.source,
    })),
    candidateSubstitutes: candidateSubstitutes.map((c) => ({
      name: c.name,
      casNumber: c.casNumber,
      category: c.category,
    })),
  });

  // 9. Build system prompt with additional context
  const availableTools = getAvailableTools("reformulation", context.plan);
  const toolDescriptions = context.enableTools
    ? formatToolDefinitionsForPrompt(availableTools)
    : "";

  const systemPrompt = [
    REFORMULATION_ADVISOR_SYSTEM_PROMPT,
    "",
    "## Additional Context",
    serializeContextForPrompt(ragContext),
    "",
    ...(toolDescriptions
      ? ["## Available Tools for Additional Data", toolDescriptions]
      : []),
    "",
    `Tenant has ${affectedProducts.length} affected products using ${ingredient.name}.`,
    `Existing substitution options in catalog: ${ingredient.substitutionOptions.length}.`,
    `Candidate substitutes from catalog: ${candidateSubstitutes.length}.`,
  ].join("\n");

  // 10. Execute LLM call with structured output
  const modelId = "gpt-4o-mini";
  let llmResult: ReformulationOutput;
  let usageData: { promptTokens: number; completionTokens: number; totalTokens: number };
  let usedFallback = false;

  try {
    const result = await executeWithFallback(
      async () => {
        const model = getPrimaryModel("reformulation");
        return generateObject({
          model,
          schema: ReformulationOutputSchema,
          prompt: reformPrompt,
          system: systemPrompt,
          temperature: getTemperatureForTask("reformulation"),
          maxRetries: 2,
        });
      },
      async () => {
        logger.warn({ tenantId: context.tenantId }, "Primary model failed, using fallback");
        usedFallback = true;
        const model = getFallbackModel("reformulation");
        return generateObject({
          model,
          schema: ReformulationOutputSchema,
          prompt: reformPrompt,
          system: systemPrompt,
          temperature: getTemperatureForTask("reformulation"),
          maxRetries: 1,
        });
      },
      "reformulation"
    );

    usedFallback = usedFallback || result.usedFallback;
    llmResult = result.result.object as ReformulationOutput;

    const pu = result.result.usage;
    usageData = {
      promptTokens: pu?.inputTokens ?? 0,
      completionTokens: pu?.outputTokens ?? 0,
      totalTokens: (pu?.inputTokens ?? 0) + (pu?.outputTokens ?? 0),
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logLlmUsage({
      tenantId: context.tenantId,
      model: modelId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      taskType: "reformulation",
      success: false,
      errorMessage,
      latencyMs,
    });

    throw new AgentError(
      `Reformulation agent failed: ${errorMessage}`,
      "reformulation",
      { tenantId: context.tenantId, ingredientId: input.ingredientId }
    );
  }

  const latencyMs = Date.now() - startTime;
  const costUsd = calculateLlmCost(
    usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    usageData.promptTokens,
    usageData.completionTokens
  );

  // Log usage
  await logLlmUsage({
    tenantId: context.tenantId,
    model: usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    promptTokens: usageData.promptTokens,
    completionTokens: usageData.completionTokens,
    totalTokens: usageData.totalTokens,
    costUsd,
    taskType: "reformulation",
    success: true,
    latencyMs,
  });

  // 11. Save AI-suggested substitutes to the database for future reference
  await saveAiSuggestedSubstitutes(context.tenantId, ingredient.id, llmResult.substitutes);

  // 12. Build the response content
  const responseContent = formatReformulationResponse(llmResult, ingredient.name, affectedProducts.length);

  // 13. Build messages for conversation
  const userMessage: AgentMessage = {
    id: `msg_${Date.now()}_u`,
    role: "user",
    content: `Find reformulation alternatives for ${ingredient.name} (${affectedProducts.length} affected products)`,
    timestamp: new Date().toISOString(),
  };

  const assistantMessage: AgentMessage = {
    id: `msg_${Date.now()}_a`,
    role: "assistant",
    content: responseContent,
    timestamp: new Date().toISOString(),
    usage: usageData,
  };

  logger.info(
    {
      tenantId: context.tenantId,
      ingredientId: input.ingredientId,
      substitutesFound: llmResult.substitutes.length,
      bestSubstitute: llmResult.recommendation.bestSubstitute,
      tokensUsed: usageData.totalTokens,
      costUsd: costUsd.toFixed(6),
      latencyMs,
      usedFallback,
    },
    "Reformulation advisor agent completed"
  );

  return {
    content: responseContent,
    toolCalls: [],
    messages: [userMessage, assistantMessage],
    usage: { ...usageData, costUsd },
    model: usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    usedFallback,
    latencyMs,
    contextUsed: ragContext,
    traceId: context.traceId,
    substitutes: llmResult.substitutes,
    recommendation: llmResult.recommendation,
  };
}

// ============================================================================
// Candidate Substitute Discovery
// ============================================================================

/**
 * Find candidate substitutes from the tenant's ingredient catalog
 * based on functional category and regulatory status.
 */
async function findCandidateSubstitutes(
  tenantId: string,
  originalIngredient: {
    id: string;
    name: string;
    category: string | null;
    isSynthetic: boolean | null;
    allergenFlags: string[];
  },
  includeAiSuggestions: boolean
): Promise<Array<{ id: string; name: string; casNumber: string | null; category: string | null }>> {
  // Find ingredients in the same functional category that aren't the original
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    tenantId,
    id: { not: originalIngredient.id },
  };

  // Prefer ingredients in the same category
  if (originalIngredient.category) {
    where.category = originalIngredient.category;
  }

  // Prefer non-synthetic if the original is synthetic
  if (originalIngredient.isSynthetic === true) {
    where.isSynthetic = false;
  }

  // Prefer ingredients without the same allergen flags
  if (originalIngredient.allergenFlags.length > 0) {
    where.allergenFlags = {
      hasEvery: { NOT: { in: originalIngredient.allergenFlags } },
    };
  }

  const candidates = await prisma.ingredient.findMany({
    where,
    select: {
      id: true,
      name: true,
      casNumber: true,
      category: true,
    },
    take: includeAiSuggestions ? 20 : 10,
    orderBy: { name: "asc" },
  });

  return candidates;
}

// ============================================================================
// Save AI Suggestions to Database
// ============================================================================

/**
 * Save AI-suggested substitutes to the SubstitutionOption table
 * so they're available for future queries and R&D validation.
 */
async function saveAiSuggestedSubstitutes(
  tenantId: string,
  originalIngredientId: string,
  substitutes: ReformulationSubstitute[]
): Promise<void> {
  for (const sub of substitutes) {
    if (sub.source !== "ai_suggestion") continue;

    // Try to find the substitute ingredient in the catalog
    let substituteIngredientId: string | null = null;
    const existingIngredient = await prisma.ingredient.findFirst({
      where: {
        tenantId,
        name: { equals: sub.ingredientName, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (existingIngredient) {
      substituteIngredientId = existingIngredient.id;
    } else {
      // Create a placeholder ingredient record for the AI suggestion
      const newIngredient = await prisma.ingredient.create({
        data: {
          tenantId,
          name: sub.ingredientName,
          casNumber: sub.casNumber,
          eenumber: sub.eenumber,
          category: sub.category,
          isSynthetic: null,
          allergenFlags: sub.allergenFlags,
          metadata: { source: "ai_suggestion", created_by_agent: "reformulation" },
        },
      });
      substituteIngredientId = newIngredient.id;
    }

    // Check if this substitution option already exists
    const existingOption = await prisma.substitutionOption.findFirst({
      where: {
        originalIngredientId,
        substituteIngredientId,
      },
    });

    if (!existingOption) {
      await prisma.substitutionOption.create({
        data: {
          tenantId,
          originalIngredientId,
          substituteIngredientId,
          substitutionCost: sub.costDeltaPerUnit ? sub.costDeltaPerUnit : null,
          feasibilityScore: sub.feasibilityScore,
          sensoryImpact: sub.sensoryImpact,
          shelfLifeImpact: sub.shelfLifeImpact,
          regulatoryRisk: sub.regulatoryRisk,
          notes: sub.reasoning,
          source: "ai_suggestion",
        },
      });
    }
  }
}

// ============================================================================
// Response Formatting
// ============================================================================

/**
 * Format the reformulation result into a human-readable response.
 */
function formatReformulationResponse(
  result: ReformulationOutput,
  ingredientName: string,
  affectedProductCount: number
): string {
  const parts: string[] = [];

  parts.push(`# Reformulation Analysis for ${ingredientName}`);
  parts.push(`${affectedProductCount} product(s) affected`);
  parts.push("");

  // Substitutes ranked by feasibility
  const ranked = [...result.substitutes].sort((a, b) => b.feasibilityScore - a.feasibilityScore);
  ranked.forEach((sub, i) => {
    const feasibilityPct = (sub.feasibilityScore * 100).toFixed(0);
    const sourceLabel = sub.source === "ai_suggestion" ? "🤖 AI Suggested" : sub.source === "existing_catalog" ? "📋 In Catalog" : "🏭 Supplier";
    parts.push(`## ${i + 1}. ${sub.ingredientName} ${sourceLabel}`);
    parts.push(`**Feasibility**: ${feasibilityPct}% | **Sensory Impact**: ${sub.sensoryImpact} | **Regulatory Risk**: ${sub.regulatoryRisk.replace(/_/g, " ")}`);
    if (sub.costDeltaPerUnit !== null) {
      const costDirection = sub.costDeltaPerUnit >= 0 ? "+" : "";
      parts.push(`**Cost Delta**: ${costDirection}$${sub.costDeltaPerUnit.toFixed(4)} per unit`);
    }
    if (sub.implementationTimelineDays !== null) {
      parts.push(`**Timeline**: ~${sub.implementationTimelineDays} days to implement`);
    }
    if (sub.allergenFlags.length > 0) {
      parts.push(`⚠️ **Allergen Flags**: ${sub.allergenFlags.join(", ")}`);
    }
    if (sub.applicableProducts.length > 0) {
      parts.push(`**Applicable to**: ${sub.applicableProducts.join(", ")}`);
    }
    parts.push(`${sub.reasoning}`);
    parts.push("");
  });

  // Recommendation
  parts.push("## Recommendation");
  if (result.recommendation.bestSubstitute) {
    parts.push(`**Best overall substitute**: ${result.recommendation.bestSubstitute}`);
  }
  parts.push(result.recommendation.reasoning);
  if (result.recommendation.estimatedTotalCost !== null) {
    parts.push(`**Total estimated cost**: $${result.recommendation.estimatedTotalCost.toLocaleString()}`);
  }
  if (result.recommendation.estimatedTimelineDays !== null) {
    parts.push(`**Implementation timeline**: ~${result.recommendation.estimatedTimelineDays} days`);
  }

  return parts.join("\n");
}

// ============================================================================
// Budget Enforcement (shared with executive-query)
// ============================================================================

async function checkLlmBudget(
  tenantId: string,
  plan: "DIAGNOSTIC" | "SCOUT" | "PRO" | "COMMAND"
): Promise<{ allowed: boolean; remaining: number }> {
  const budget = AGENT_CONFIG.TOKEN_BUDGETS[plan];
  if (budget.daily === 0) {
    return { allowed: false, remaining: 0 };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const usage = await prisma.llmUsageLog.aggregate({
    where: {
      tenantId,
      taskType: { in: ["query_agent", "reformulation", "decision_package"] },
      createdAt: { gte: todayStart },
      success: true,
    },
    _sum: { totalTokens: true },
  });

  const usedToday = usage._sum.totalTokens ?? 0;
  return {
    allowed: budget.daily - usedToday > 0,
    remaining: Math.max(0, budget.daily - usedToday),
  };
}
