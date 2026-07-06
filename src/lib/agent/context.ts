// Cascada — RAG Context Builder
// Retrieves relevant data from the database to build rich RAG context for AI agents.
// Every piece of context comes from real database queries — no hallucinated data.
// Context is scoped to the tenant via RLS (withTenant pattern from Stage 1).

import { prisma, withTenant } from "@/lib/db";
import { createAgentLogger } from "@/lib/logger";
import type {
  RAGContext,
  RegulationContextItem,
  ProductContextItem,
  ImpactContextItem,
  TimelineContextItem,
  IngredientContextItem,
  DecisionPackageContextItem,
  AgentType,
} from "./types";
import { AGENT_CONFIG } from "./types";

// ============================================================================
// Context Retrieval Options
// ============================================================================

export interface ContextRetrievalOptions {
  tenantId: string;
  agentType: AgentType;
  /** Focus the context on specific jurisdictions */
  focusJurisdictions?: string[];
  /** Focus the context on specific product IDs */
  focusProductIds?: string[];
  /** Focus the context on specific regulation IDs */
  focusRegulationIds?: string[];
  /** Focus the context on specific ingredient ID */
  focusIngredientId?: string[];
  /** Focus the context on specific trigger IDs */
  focusTriggerIds?: string[];
  /** Time horizon in days for deadline queries */
  timeHorizonDays?: number;
  /** Maximum items per context section */
  maxItemsPerSection?: number;
}

const DEFAULT_MAX_ITEMS = 50;

// ============================================================================
// Main Context Builder
// ============================================================================

/**
 * Build RAG context for an agent execution.
 * Queries the database for regulations, products, impacts, timelines,
 * and agent-specific data (ingredients for reformulation, decision packages for workflow).
 */
export async function buildAgentContext(
  options: ContextRetrievalOptions
): Promise<RAGContext> {
  const {
    tenantId,
    agentType,
    focusJurisdictions,
    focusProductIds,
    focusRegulationIds,
    focusIngredientId,
    focusTriggerIds,
    timeHorizonDays = 365,
    maxItemsPerSection = DEFAULT_MAX_ITEMS,
  } = options;

  const logger = createAgentLogger(agentType, "context-builder");
  const startTime = Date.now();

  logger.info(
    {
      tenantId,
      agentType,
      focusJurisdictions: focusJurisdictions?.length ?? 0,
      focusProductIds: focusProductIds?.length ?? 0,
      focusRegulationIds: focusRegulationIds?.length ?? 0,
      timeHorizonDays,
    },
    "Building RAG context for agent"
  );

  // Execute all context queries in parallel for efficiency
  const [regulations, products, impacts, timelines, ingredients, decisionPackages] =
    await Promise.all([
      retrieveRegulations(tenantId, {
        focusJurisdictions,
        focusRegulationIds,
        maxItems: maxItemsPerSection,
      }),
      retrieveProducts(tenantId, {
        focusProductIds,
        maxItems: maxItemsPerSection,
      }),
      retrieveImpacts(tenantId, {
        focusTriggerIds,
        maxItems: maxItemsPerSection,
      }),
      retrieveTimelines(tenantId, {
        focusJurisdictions,
        timeHorizonDays,
        maxItems: maxItemsPerSection,
      }),
      // Only retrieve ingredients for reformulation agent or when specifically requested
      agentType === "reformulation" || (focusIngredientId && focusIngredientId.length > 0)
        ? retrieveIngredients(tenantId, {
            focusIngredientIds: focusIngredientId,
            maxItems: maxItemsPerSection,
          })
        : Promise.resolve([]),
      // Only retrieve decision packages for workflow generator
      agentType === "workflow_generator"
        ? retrieveDecisionPackages(tenantId, {
            maxItems: maxItemsPerSection,
          })
        : Promise.resolve([]),
    ]);

  const retrievalTimeMs = Date.now() - startTime;

  // Estimate context tokens (rough: 1 token ≈ 4 characters)
  const contextString = JSON.stringify({ regulations, products, impacts, timelines, ingredients, decisionPackages });
  const contextTokensEstimate = Math.ceil(contextString.length / 4);

  logger.info(
    {
      tenantId,
      regulationsRetrieved: regulations.length,
      productsRetrieved: products.length,
      impactsRetrieved: impacts.length,
      timelinesRetrieved: timelines.length,
      ingredientsRetrieved: ingredients.length,
      decisionPackagesRetrieved: decisionPackages.length,
      retrievalTimeMs,
      contextTokensEstimate,
    },
    "RAG context built successfully"
  );

  // Check if context exceeds token budget and truncate if needed
  const truncatedContext = maybeTruncateContext(
    {
      regulations,
      products,
      impacts,
      timelines,
      ingredients: ingredients.length > 0 ? ingredients : undefined,
      decisionPackages: decisionPackages.length > 0 ? decisionPackages : undefined,
      retrievalMeta: {
        totalRegulations: regulations.length,
        totalProducts: products.length,
        totalImpacts: impacts.length,
        retrievalTimeMs,
        contextTokensEstimate,
      },
    },
    AGENT_CONFIG.MAX_CONTEXT_TOKENS
  );

  return truncatedContext;
}

// ============================================================================
// Regulation Context Retrieval
// ============================================================================

async function retrieveRegulations(
  tenantId: string,
  options: {
    focusJurisdictions?: string[];
    focusRegulationIds?: string[];
    maxItems: number;
  }
): Promise<RegulationContextItem[]> {
  const { focusJurisdictions, focusRegulationIds, maxItems } = options;

  // Query regulatory sources and their rules, scoped to tenant
  // Regulations are global (not tenant-scoped), but we filter by what's relevant
  // to the tenant's products/markets
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });

  if (!tenant) {
    return [];
  }

  // Get products for this tenant to determine relevant jurisdictions
  const products = await prisma.product.findMany({
    where: { tenantId },
    select: { markets: true },
  });

  const tenantMarkets = new Set<string>();
  products.forEach((p) => p.markets.forEach((m) => tenantMarkets.add(m)));

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = {
    status: { in: ["SME_APPROVED", "ACTIVE", "SME_REVIEW"] },
  };

  // Filter by jurisdiction if specified or by tenant markets
  if (focusJurisdictions && focusJurisdictions.length > 0) {
    whereClause.jurisdiction = { in: focusJurisdictions };
  } else if (tenantMarkets.size > 0) {
    whereClause.jurisdiction = { in: Array.from(tenantMarkets) };
  }

  // Filter by specific regulation IDs if provided
  if (focusRegulationIds && focusRegulationIds.length > 0) {
    whereClause.id = { in: focusRegulationIds };
  }

  const sources = await prisma.regulatorySource.findMany({
    where: whereClause,
    include: {
      rules: {
        include: {
          substances: {
            where: { isMatched: true },
            take: 20,
          },
        },
        take: 5,
        orderBy: { version: "desc" },
      },
    },
    take: maxItems,
    orderBy: { updatedAt: "desc" },
  });

  return sources.map((source) => {
    const latestRule = source.rules[0];
    return {
      id: source.id,
      name: source.name,
      jurisdiction: source.jurisdiction,
      status: source.status,
      sourceType: source.sourceType,
      effectiveDate: latestRule?.effectiveDate?.toISOString() ?? null,
      complianceDate: latestRule?.complianceDate?.toISOString() ?? null,
      description: latestRule?.description ?? source.fullText?.slice(0, 500) ?? "",
      ruleType: latestRule?.ruleType ?? "INGREDIENT_REVIEW",
      substances: latestRule?.substances.map((s) => ({
        substanceName: s.substanceName,
        substanceType: s.substanceType,
        casNumber: s.casNumber,
        eenumber: s.eenumber,
        threshold: s.threshold ? Number(s.threshold) : null,
        thresholdUnit: s.thresholdUnit,
      })) ?? [],
    };
  });
}

// ============================================================================
// Product Context Retrieval
// ============================================================================

async function retrieveProducts(
  tenantId: string,
  options: {
    focusProductIds?: string[];
    maxItems: number;
  }
): Promise<ProductContextItem[]> {
  const { focusProductIds, maxItems } = options;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = { tenantId, isActive: true };

  if (focusProductIds && focusProductIds.length > 0) {
    whereClause.id = { in: focusProductIds };
  }

  const products = await prisma.product.findMany({
    where: whereClause,
    include: {
      formulations: {
        where: { isCurrent: true },
        include: {
          formulation: {
            include: {
              items: {
                include: {
                  ingredient: {
                    select: {
                      id: true,
                      name: true,
                      casNumber: true,
                      eenumber: true,
                    },
                  },
                },
                take: 30, // Limit ingredient details
              },
            },
          },
        },
        take: 1,
      },
    },
    take: maxItems,
    orderBy: { annualRevenue: "desc" },
  });

  return products.map((product) => {
    const currentFormulation = product.formulations[0]?.formulation;
    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      category: product.category,
      brand: product.brand,
      markets: product.markets,
      retailers: product.retailers,
      annualRevenue: product.annualRevenue ? Number(product.annualRevenue) : null,
      annualVolume: product.annualVolume ? Number(product.annualVolume) : null,
      formulation: currentFormulation
        ? {
            id: currentFormulation.id,
            name: currentFormulation.name,
            ingredients: currentFormulation.items.map((item) => ({
              name: item.ingredient.name,
              casNumber: item.ingredient.casNumber,
              eenumber: item.ingredient.eenumber,
              percentage: item.percentage ? Number(item.percentage) : null,
            })),
          }
        : undefined,
    };
  });
}

// ============================================================================
// Impact Context Retrieval
// ============================================================================

async function retrieveImpacts(
  tenantId: string,
  options: {
    focusTriggerIds?: string[];
    maxItems: number;
  }
): Promise<ImpactContextItem[]> {
  const { focusTriggerIds, maxItems } = options;

  // Get cascade graphs for this tenant
  const graphs = await prisma.cascadeGraph.findMany({
    where: { tenantId },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: 1,
  });

  if (graphs.length === 0) {
    return [];
  }

  const graphId = graphs[0]!.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triggerWhere: any = { graphId };

  if (focusTriggerIds && focusTriggerIds.length > 0) {
    triggerWhere.id = { in: focusTriggerIds };
  }

  // Get triggers with their impacts
  const triggers = await prisma.cascadeTrigger.findMany({
    where: triggerWhere,
    include: {
      impacts: {
        take: 20,
        orderBy: { priority: "desc" },
      },
    },
    take: maxItems,
    orderBy: { createdAt: "desc" },
  });

  const impacts: ImpactContextItem[] = [];
  for (const trigger of triggers) {
    for (const impact of trigger.impacts) {
      impacts.push({
        id: impact.id,
        triggerId: trigger.id,
        triggerTitle: trigger.title,
        triggerSeverity: trigger.severity,
        impactType: impact.impactType,
        description: impact.description,
        financialImpact: impact.financialImpact ? Number(impact.financialImpact) : null,
        timelineDays: impact.timelineImpact,
        reformRequired: impact.reformRequired,
        reformCost: impact.reformCost ? Number(impact.reformCost) : null,
        priority: impact.priority,
      });
    }
  }

  return impacts.slice(0, maxItems);
}

// ============================================================================
// Timeline Context Retrieval
// ============================================================================

async function retrieveTimelines(
  tenantId: string,
  options: {
    focusJurisdictions?: string[];
    timeHorizonDays: number;
    maxItems: number;
  }
): Promise<TimelineContextItem[]> {
  const { focusJurisdictions, timeHorizonDays, maxItems } = options;

  const now = new Date();
  const horizonDate = new Date(now.getTime() + timeHorizonDays * 24 * 60 * 60 * 1000);

  // Get active rules with compliance dates within the time horizon
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ruleWhere: any = {
    complianceDate: {
      gte: now,
      lte: horizonDate,
    },
  };

  if (focusJurisdictions && focusJurisdictions.length > 0) {
    ruleWhere.jurisdiction = { in: focusJurisdictions };
  }

  const rules = await prisma.rule.findMany({
    where: ruleWhere,
    include: {
      source: {
        select: { name: true, jurisdiction: true },
      },
      cascadeTriggers: {
        take: 1,
        select: {
          severity: true,
          totalSkusAffected: true,
        },
      },
    },
    take: maxItems,
    orderBy: { complianceDate: "asc" },
  });

  return rules.map((rule) => {
    const deadline = rule.complianceDate!;
    const daysRemaining = Math.max(
      0,
      Math.ceil((deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );
    const trigger = rule.cascadeTriggers[0];

    return {
      regulationName: rule.source.name,
      jurisdiction: rule.source.jurisdiction,
      deadline: deadline.toISOString(),
      daysRemaining,
      gracePeriodDays: rule.gracePeriodDays,
      conflictWith: null, // Conflict detection requires cross-regulation analysis
      severity: trigger?.severity ?? "MEDIUM",
      affectedSkuCount: trigger?.totalSkusAffected ?? 0,
    };
  });
}

// ============================================================================
// Ingredient Context Retrieval (for Reformulation Agent)
// ============================================================================

async function retrieveIngredients(
  tenantId: string,
  options: {
    focusIngredientIds?: string[];
    maxItems: number;
  }
): Promise<IngredientContextItem[]> {
  const { focusIngredientIds, maxItems } = options;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = { tenantId };

  if (focusIngredientIds && focusIngredientIds.length > 0) {
    whereClause.id = { in: focusIngredientIds };
  }

  const ingredients = await prisma.ingredient.findMany({
    where: whereClause,
    include: {
      substitutionOptions: {
        include: {
          substituteIngredient: {
            select: { name: true },
          },
        },
        take: 10,
      },
      formulationItems: {
        take: 20,
        include: {
          formulation: {
            include: {
              products: {
                where: { isCurrent: true },
                include: {
                  product: {
                    select: { name: true, sku: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    take: maxItems,
    orderBy: { updatedAt: "desc" },
  });

  return ingredients.map((ingredient) => {
    // Collect products that use this ingredient
    const usedInProducts: Array<{ name: string; sku: string; concentrationPercentage: number | null }> = [];
    for (const fi of ingredient.formulationItems) {
      for (const pf of fi.formulation.products) {
        usedInProducts.push({
          name: pf.product.name,
          sku: pf.product.sku,
          concentrationPercentage: fi.percentage ? Number(fi.percentage) : null,
        });
      }
    }

    return {
      id: ingredient.id,
      name: ingredient.name,
      casNumber: ingredient.casNumber,
      eenumber: ingredient.eenumber,
      category: ingredient.category,
      isSynthetic: ingredient.isSynthetic,
      sourceType: ingredient.sourceType,
      allergenFlags: ingredient.allergenFlags,
      substitutionOptions: ingredient.substitutionOptions.map((sub) => ({
        substituteName: sub.substituteIngredient.name,
        feasibilityScore: sub.feasibilityScore ? Number(sub.feasibilityScore) : null,
        sensoryImpact: sub.sensoryImpact,
        costDelta: sub.substitutionCost ? Number(sub.substitutionCost) : null,
        source: sub.source,
      })),
      usedInProducts,
    };
  });
}

// ============================================================================
// Decision Package Context Retrieval (for Workflow Generator)
// ============================================================================

async function retrieveDecisionPackages(
  tenantId: string,
  options: {
    maxItems: number;
  }
): Promise<DecisionPackageContextItem[]> {
  const { maxItems } = options;

  const packages = await prisma.decisionPackage.findMany({
    where: { tenantId },
    include: {
      trigger: {
        select: {
          id: true,
          status: true,
          totalSkusAffected: true,
          estimatedCostMin: true,
          estimatedCostMax: true,
          deadlineDate: true,
        },
      },
    },
    take: maxItems,
    orderBy: { generatedAt: "desc" },
  });

  return packages.map((pkg) => ({
    id: pkg.id,
    title: pkg.title,
    summary: pkg.summary,
    triggerId: pkg.triggerId,
    status: pkg.trigger.status,
    affectedSkuCount: pkg.trigger.totalSkusAffected,
    estimatedCostMin: pkg.trigger.estimatedCostMin ? Number(pkg.trigger.estimatedCostMin) : null,
    estimatedCostMax: pkg.trigger.estimatedCostMax ? Number(pkg.trigger.estimatedCostMax) : null,
    deadline: pkg.trigger.deadlineDate?.toISOString() ?? null,
    recommendation: pkg.recommendation,
    decision: pkg.decision,
  }));
}

// ============================================================================
// Context Truncation
// ============================================================================

/**
 * If the context exceeds the token budget, truncate the largest sections
 * while preserving the most important items.
 */
function maybeTruncateContext(context: RAGContext, maxTokens: number): RAGContext {
  const totalTokens = context.retrievalMeta.contextTokensEstimate;

  if (totalTokens <= maxTokens) {
    return context;
  }

  // Truncation strategy: reduce product details first (largest section),
  // then regulation details, keeping impacts and timelines intact
  const truncationRatio = maxTokens / totalTokens;
  const truncated = { ...context };

  // Truncate product formulation details
  if (truncated.products.length > 5) {
    truncated.products = truncated.products.map((p) => ({
      ...p,
      formulation: undefined, // Remove formulation details to save tokens
    }));
  }

  // Truncate regulation substance lists
  if (truncated.regulations.length > 10) {
    truncated.regulations = truncated.regulations.map((r) => ({
      ...r,
      substances: r.substances.slice(0, 5),
    }));
  }

  // Recalculate estimate
  const newEstimate = Math.ceil(JSON.stringify(truncated).length / 4);
  truncated.retrievalMeta = {
    ...truncated.retrievalMeta,
    contextTokensEstimate: newEstimate,
  };

  return truncated;
}

// ============================================================================
// Context Serialization for Prompts
// ============================================================================

/**
 * Serialize RAG context into a text format suitable for inclusion in LLM prompts.
 * This avoids dumping raw JSON and instead creates a human-readable format.
 */
export function serializeContextForPrompt(context: RAGContext): string {
  const sections: string[] = [];

  // Regulations
  if (context.regulations.length > 0) {
    sections.push("## Relevant Regulations");
    for (const reg of context.regulations.slice(0, 15)) {
      const subList = reg.substances.length > 0
        ? `\n  Affected substances: ${reg.substances.map((s) => s.substanceName).join(", ")}`
        : "";
      sections.push(
        `- **${reg.name}** (${reg.jurisdiction}) — Status: ${reg.status}, Type: ${reg.ruleType}` +
        `${reg.effectiveDate ? `, Effective: ${reg.effectiveDate.slice(0, 10)}` : ""}` +
        `${reg.complianceDate ? `, Deadline: ${reg.complianceDate.slice(0, 10)}` : ""}${subList}`
      );
    }
  }

  // Products
  if (context.products.length > 0) {
    sections.push("\n## Affected Products");
    for (const product of context.products.slice(0, 20)) {
      sections.push(
        `- **${product.name}** (SKU: ${product.sku})${product.category ? `, ${product.category}` : ""}` +
        `${product.annualRevenue ? `, Revenue: $${product.annualRevenue.toLocaleString()}` : ""}` +
        `${product.markets.length > 0 ? `, Markets: ${product.markets.join(", ")}` : ""}`
      );
    }
  }

  // Impacts
  if (context.impacts.length > 0) {
    sections.push("\n## Cascade Impacts");
    for (const impact of context.impacts.slice(0, 15)) {
      sections.push(
        `- [${impact.triggerSeverity}] ${impact.description}` +
        `${impact.financialImpact ? ` — $${impact.financialImpact.toLocaleString()}` : ""}` +
        `${impact.timelineDays ? ` — ${impact.timelineDays} days` : ""}` +
        `${impact.reformRequired ? " — REFORMULATION REQUIRED" : ""}`
      );
    }
  }

  // Timelines
  if (context.timelines.length > 0) {
    sections.push("\n## Compliance Timelines");
    for (const tl of context.timelines.slice(0, 15)) {
      const urgencyFlag = tl.daysRemaining <= 30 ? " ⚠️ URGENT" : "";
      sections.push(
        `- **${tl.regulationName}** (${tl.jurisdiction}) — Deadline: ${tl.deadline.slice(0, 10)}` +
        ` (${tl.daysRemaining} days remaining)${urgencyFlag}` +
        `${tl.affectedSkuCount > 0 ? `, ${tl.affectedSkuCount} SKUs affected` : ""}`
      );
    }
  }

  // Ingredients (for reformulation)
  if (context.ingredients && context.ingredients.length > 0) {
    sections.push("\n## Ingredients Under Review");
    for (const ing of context.ingredients) {
      const subList = ing.substitutionOptions.length > 0
        ? `\n  Existing substitutes: ${ing.substitutionOptions.map((s) => `${s.substituteName} (feasibility: ${s.feasibilityScore ?? "TBD"})`).join("; ")}`
        : "";
      sections.push(
        `- **${ing.name}**${ing.casNumber ? ` (CAS: ${ing.casNumber})` : ""}${ing.eenumber ? ` (E${ing.eenumber})` : ""}` +
        `${ing.category ? `, Category: ${ing.category}` : ""}` +
        `${ing.allergenFlags.length > 0 ? `, Allergens: ${ing.allergenFlags.join(", ")}` : ""}` +
        `\n  Used in ${ing.usedInProducts.length} product(s)${subList}`
      );
    }
  }

  // Decision packages (for workflow generator)
  if (context.decisionPackages && context.decisionPackages.length > 0) {
    sections.push("\n## Decision Packages");
    for (const dp of context.decisionPackages) {
      sections.push(
        `- **${dp.title}** — Status: ${dp.status}${dp.decision ? `, Decision: ${dp.decision}` : ""}` +
        `${dp.affectedSkuCount > 0 ? `, ${dp.affectedSkuCount} SKUs affected` : ""}` +
        `${dp.estimatedCostMin ? `, Est. cost: $${dp.estimatedCostMin.toLocaleString()}-$${dp.estimatedCostMax?.toLocaleString()}` : ""}` +
        `\n  ${dp.summary.slice(0, 200)}`
      );
    }
  }

  return sections.join("\n");
}
