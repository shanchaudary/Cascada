// Cascada — Cascade Cost Model
// Estimates reformulation and label change costs for cascade impacts.
//
// The cost model is the bridge between "this ingredient is affected by a regulation"
// and "here's how much it will cost your business to comply." It produces
// concrete dollar estimates that go into Decision Packages for the C-suite.
//
// Cost components for reformulation:
// 1. Ingredient substitution cost (new ingredient vs old, per unit)
// 2. R&D testing cost (stability, sensory, shelf life)
// 3. Regulatory filing cost (GRAS determination, label approval)
// 4. Production line changeover cost (equipment, process changes)
// 5. Market testing cost (consumer acceptance, A/B testing)
// 6. Inventory write-off cost (existing packaging, work-in-progress)
//
// Cost components for label changes:
// 1. Design and regulatory review
// 2. Printing plate/tooling changes
// 3. Print run cost (new labels/packaging)
// 4. Inventory transition cost (old → new labels)
// 5. Distribution chain notification
//
// All costs are estimated ranges (min-max) to account for uncertainty.

import { prisma, withTenant } from "@/lib/db";
import { createCascadeLogger } from "@/lib/logger";
import { CASCADE_CONFIG } from "@/lib/constants";
import type { ImpactType, RuleType } from "@prisma/client";
import type {
  ReformulationCostEstimate,
  LabelChangeCostEstimate,
  CascadeCostSummary,
} from "@/types/cascade";

// ============================================================================
// Types
// ============================================================================

export interface CostEstimationInput {
  triggerId: string;
  tenantId: string;
  impactIds: string[];
}

export interface SubstitutionCostDetail {
  substituteId: string;
  substituteName: string;
  costDeltaPerUnit: number;
  feasibilityScore: number;
  sensoryImpact: string;
  shelfLifeImpact: string;
  regulatoryRisk: string;
  estimatedTimelineDays: number;
  totalCost: number;
}

// ============================================================================
// Cost Constants
// ============================================================================

/** R&D testing cost ranges by product complexity */
const RD_TESTING_COSTS = {
  simple: { min: 15_000, max: 50_000 },     // Single ingredient swap
  moderate: { min: 50_000, max: 150_000 },   // Multiple ingredients, sensory impact
  complex: { min: 150_000, max: 400_000 },   // Full reformulation, new process
} as const;

/** Regulatory filing cost by jurisdiction */
const REGULATORY_FILING_COSTS = {
  domestic: { min: 5_000, max: 25_000 },
  multi_state: { min: 15_000, max: 75_000 },
  international: { min: 50_000, max: 200_000 },
} as const;

/** Production changeover cost by scale */
const PRODUCTION_CHANGEOVER_COSTS = {
  small: { min: 5_000, max: 25_000 },       // < 10 SKUs
  medium: { min: 25_000, max: 100_000 },     // 10-50 SKUs
  large: { min: 100_000, max: 500_000 },     // 50+ SKUs
} as const;

/** Market testing cost */
const MARKET_TESTING_COSTS = {
  standard: { min: 10_000, max: 50_000 },
  extensive: { min: 50_000, max: 150_000 },
} as const;

/** Label change cost ranges */
const LABEL_CHANGE_COSTS = {
  add_warning: { min: 5_000, max: 25_000 },
  remove_claim: { min: 3_000, max: 15_000 },
  update_ingredients: { min: 8_000, max: 40_000 },
  new_disclosure: { min: 10_000, max: 50_000 },
} as const;

/** Per-SKU packaging/printing cost by volume */
const PER_SKU_PRINTING_COST = {
  low_volume: 2_500,      // < 10K units/year
  medium_volume: 5_000,   // 10K-100K units/year
  high_volume: 15_000,    // 100K+ units/year
} as const;

/** Inventory write-off as percentage of annual production value */
const INVENTORY_WRITE_OFF_RATE = 0.03; // 3% of annual production value

const logger = createCascadeLogger("cost-model");

// ============================================================================
// Cost Model Implementation
// ============================================================================

/**
 * Estimate total cascade costs for a trigger.
 * Produces reformulation cost estimates for each affected ingredient,
 * label change cost estimates for each affected product, and a
 * total cost summary with min/max ranges.
 */
export async function estimateCascadeCosts(
  input: CostEstimationInput
): Promise<CascadeCostSummary> {
  const { triggerId, tenantId, impactIds } = input;

  logger.info({ triggerId, tenantId, impactCount: impactIds.length }, "Starting cascade cost estimation");

  try {
    return await withTenant(tenantId, async () => {
      const trigger = await prisma.cascadeTrigger.findUnique({
        where: { id: triggerId },
        include: {
          rule: {
            include: {
              substances: { where: { isMatched: true } },
              source: true,
            },
          },
          impacts: {
            where: { id: { in: impactIds } },
            include: { node: true },
          },
        },
      });

      if (!trigger) {
        throw new Error(`Trigger ${triggerId} not found`);
      }

      // Separate impacts by type for targeted cost estimation
      const reformulationImpacts = trigger.impacts.filter(
        (i) => i.impactType === "REFORMULATION_REQUIRED" || i.impactType === "REFORMULATION_COST"
      );
      const labelChangeImpacts = trigger.impacts.filter(
        (i) => i.impactType === "LABEL_CHANGE_REQUIRED"
      );

      // Estimate reformulation costs
      const reformulationCosts: ReformulationCostEstimate[] = [];
      for (const impact of reformulationImpacts) {
        if (impact.node.nodeType === "INGREDIENT") {
          const costEstimate = await estimateReformulationCost(
            impact.node.entityId,
            trigger.rule.ruleType,
            tenantId
          );
          reformulationCosts.push(costEstimate);
        } else if (impact.node.nodeType === "FORMULATION") {
          // For formulation impacts, estimate costs for each ingredient in the formulation
          const items = await prisma.formulationItem.findMany({
            where: { formulationId: impact.node.entityId },
            include: { ingredient: true },
          });
          for (const item of items) {
            const ingredient = item.ingredient;
            // Only estimate for ingredients that have rule substance matches
            const hasSubstanceMatch = trigger.rule.substances.some(
              (rs) => rs.ingredientId === ingredient.id
            );
            if (hasSubstanceMatch) {
              const costEstimate = await estimateReformulationCost(
                ingredient.id,
                trigger.rule.ruleType,
                tenantId
              );
              reformulationCosts.push(costEstimate);
            }
          }
        }
      }

      // Estimate label change costs
      const labelChangeCosts: LabelChangeCostEstimate[] = [];
      for (const impact of labelChangeImpacts) {
        if (impact.node.nodeType === "PRODUCT") {
          const costEstimate = await estimateLabelChangeCost(
            impact.node.entityId,
            trigger.rule.ruleType,
            tenantId
          );
          labelChangeCosts.push(costEstimate);
        }
      }

      // Calculate totals
      const reformTotal = reformulationCosts.reduce(
        (sum, rc) => sum + (rc.bestOption?.totalCost ?? rc.substituteOptions.reduce((s, o) => s + o.totalCost, 0) / Math.max(rc.substituteOptions.length, 1)),
        0
      );
      const labelTotal = labelChangeCosts.reduce(
        (sum, lc) => sum + lc.estimatedCost,
        0
      );

      const totalCostMin = reformTotal * 0.6 + labelTotal * 0.8;
      const totalCostMax = reformTotal * 1.4 + labelTotal * 1.2;

      // Estimate total timeline (longest reformulation or label change)
      const maxReformTimeline = reformulationCosts.reduce(
        (max, rc) => Math.max(max, rc.bestOption?.timelineDays ?? 180),
        0
      );
      const maxLabelTimeline = labelChangeCosts.reduce(
        (max, lc) => Math.max(max, lc.timelineDays),
        0
      );
      const timelineDays = Math.max(maxReformTimeline, maxLabelTimeline);

      // Calculate revenue at risk
      const productImpacts = trigger.impacts.filter(
        (i) => i.node.nodeType === "PRODUCT" && i.financialImpact
      );
      const revenueAtRisk = productImpacts.reduce(
        (sum, i) => sum + (i.financialImpact?.toNumber() ?? 0),
        0
      );

      const costSummary: CascadeCostSummary = {
        reformulationCosts,
        labelChangeCosts,
        totalCostMin,
        totalCostMax,
        timelineDays,
        revenueAtRisk,
      };

      // Update trigger with cost estimates
      await prisma.cascadeTrigger.update({
        where: { id: triggerId },
        data: {
          estimatedCostMin: totalCostMin,
          estimatedCostMax: totalCostMax,
        },
      });

      // Update reformulation options on impact records
      for (const rc of reformulationCosts) {
        const impact = trigger.impacts.find(
          (i) => i.node.nodeType === "INGREDIENT" && i.node.entityId === rc.ingredientId
        );
        if (impact) {
          await prisma.cascadeImpact.update({
            where: { id: impact.id },
            data: {
              reformCost: rc.bestOption?.totalCost ?? null,
              reformOptions: {
                substitutionOptions: rc.substituteOptions.map((so) => ({
                  substituteId: so.substituteId,
                  substituteName: so.substituteName,
                  costDelta: so.costDelta,
                  feasibilityScore: so.feasibilityScore,
                  sensoryImpact: so.sensoryImpact,
                  shelfLifeImpact: so.shelfLifeImpact,
                  regulatoryRisk: so.regulatoryRisk,
                  estimatedTimelineDays: so.estimatedTimelineDays,
                  totalCost: so.totalCost,
                })),
                bestOption: rc.bestOption,
              } as object,
            },
          });
        }
      }

      logger.info(
        {
          triggerId,
          reformulationCount: reformulationCosts.length,
          labelChangeCount: labelChangeCosts.length,
          totalCostMin,
          totalCostMax,
          revenueAtRisk,
        },
        "Cascade cost estimation completed"
      );

      return costSummary;
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown cost estimation error";
    logger.error({ triggerId, error: msg }, "Cost estimation failed");
    throw error;
  }
}

/**
 * Estimate reformulation cost for a single ingredient.
 * Looks up substitution options and calculates the full cost of switching.
 */
async function estimateReformulationCost(
  ingredientId: string,
  ruleType: RuleType,
  tenantId: string
): Promise<ReformulationCostEstimate> {
  const ingredient = await prisma.ingredient.findUnique({
    where: { id: ingredientId },
    include: {
      substitutionOptions: {
        include: {
          substituteIngredient: true,
        },
        orderBy: { feasibilityScore: "desc" },
      },
    },
  });

  if (!ingredient) {
    throw new Error(`Ingredient ${ingredientId} not found`);
  }

  // Estimate substitution options
  const substituteOptions: ReformulationCostEstimate["substituteOptions"] = [];

  for (const sub of ingredient.substitutionOptions) {
    const costDelta = sub.substitutionCost?.toNumber() ?? 0;
    const feasibility = sub.feasibilityScore?.toNumber() ?? 0.5;

    // Estimate total reformulation cost including R&D, regulatory, production
    const complexity = getReformulationComplexity(ruleType, feasibility);
    const rdCost = midpoint(RD_TESTING_COSTS[complexity]);
    const regCost = midpoint(REGULATORY_FILING_COSTS.domestic);
    const productionCost = midpoint(PRODUCTION_CHANGEOVER_COSTS.small);
    const marketCost = midpoint(MARKET_TESTING_COSTS.standard);

    // Estimate affected product volume for inventory write-off
    const affectedRevenue = await getIngredientAffectedRevenue(ingredientId, tenantId);
    const inventoryWriteOff = affectedRevenue * INVENTORY_WRITE_OFF_RATE;

    // Total cost = substitution delta + R&D + regulatory + production + market + write-off
    const substitutionTotalCost = Math.abs(costDelta) + rdCost + regCost + productionCost + marketCost + inventoryWriteOff;

    // Timeline based on complexity and feasibility
    const timelineDays = complexity === "simple" ? 60 : complexity === "moderate" ? 120 : 240;

    substituteOptions.push({
      substituteId: sub.substituteIngredientId,
      substituteName: sub.substituteIngredient.name,
      costDelta,
      feasibilityScore: feasibility,
      sensoryImpact: sub.sensoryImpact ?? "unknown",
      shelfLifeImpact: sub.shelfLifeImpact ?? "unknown",
      regulatoryRisk: sub.regulatoryRisk ?? "unknown",
      estimatedTimelineDays: timelineDays,
      totalCost: substitutionTotalCost,
    });
  }

  // If no substitution options exist, create a placeholder
  if (substituteOptions.length === 0) {
    const affectedRevenue = await getIngredientAffectedRevenue(ingredientId, tenantId);
    const placeholderCost = midpoint(RD_TESTING_COSTS.moderate) +
      midpoint(REGULATORY_FILING_COSTS.domestic) +
      midpoint(PRODUCTION_CHANGEOVER_COSTS.small) +
      affectedRevenue * INVENTORY_WRITE_OFF_RATE;

    substituteOptions.push({
      substituteId: "pending",
      substituteName: "R&D assessment required",
      costDelta: 0,
      feasibilityScore: 0,
      sensoryImpact: "unknown",
      shelfLifeImpact: "unknown",
      regulatoryRisk: "review_needed",
      estimatedTimelineDays: 180,
      totalCost: placeholderCost,
    });
  }

  // Sort by total cost (cheapest first) and pick the best option
  substituteOptions.sort((a, b) => a.totalCost - b.totalCost);
  const bestSub = substituteOptions[0];

  if (!bestSub) {
    return {
      ingredientId,
      ingredientName: ingredient.name,
      substituteOptions,
      bestOption: null,
    };
  }

  const bestOption = bestSub.feasibilityScore > 0
    ? {
        substituteId: bestSub.substituteId,
        substituteName: bestSub.substituteName,
        totalCost: bestSub.totalCost,
        timelineDays: bestSub.estimatedTimelineDays,
        riskLevel: bestSub.regulatoryRisk === "none" ? "low" : bestSub.regulatoryRisk === "review_needed" ? "medium" : "high",
      }
    : null;

  return {
    ingredientId,
    ingredientName: ingredient.name,
    substituteOptions,
    bestOption,
  };
}

/**
 * Estimate label change cost for a product.
 */
async function estimateLabelChangeCost(
  productId: string,
  ruleType: RuleType,
  tenantId: string
): Promise<LabelChangeCostEstimate> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw new Error(`Product ${productId} not found`);
  }

  // Determine change type based on rule type
  const changeType = ruleTypeToChangeType(ruleType);

  // Calculate base label change cost
  const baseCost = midpoint(LABEL_CHANGE_COSTS[changeType]);

  // Per-SKU printing cost based on volume
  const annualVolume = product.annualVolume?.toNumber() ?? 0;
  const volumeCategory = annualVolume > 100_000
    ? "high_volume"
    : annualVolume > 10_000
      ? "medium_volume"
      : "low_volume";
  const printingCost = PER_SKU_PRINTING_COST[volumeCategory];

  // Inventory transition cost (existing inventory that needs new labels)
  const annualRevenue = product.annualRevenue?.toNumber() ?? 0;
  const inventoryCost = annualRevenue * INVENTORY_WRITE_OFF_RATE;

  const totalCost = baseCost + printingCost + inventoryCost;

  // Timeline for label changes is typically 30-90 days
  const timelineDays = changeType === "new_disclosure" ? 90 : changeType === "add_warning" ? 60 : 45;

  // Determine affected markets
  const affectedMarkets = product.markets.length > 0 ? product.markets : ["US"];

  return {
    productId,
    productName: product.name,
    sku: product.sku,
    changeType,
    estimatedCost: totalCost,
    timelineDays,
    affectedMarkets,
    printRunSize: annualVolume > 0 ? Math.ceil(annualVolume * 0.1) : null,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function midpoint(range: { min: number; max: number }): number {
  return (range.min + range.max) / 2;
}

function getReformulationComplexity(
  ruleType: RuleType,
  feasibility: number
): "simple" | "moderate" | "complex" {
  // Bans and phase-outs require complete reformulation (complex)
  if (ruleType === "BAN" || ruleType === "PHASE_OUT" || ruleType === "MARKET_WITHDRAWAL") {
    return "complex";
  }
  // High feasibility substitutions are simpler
  if (feasibility > 0.8) return "simple";
  if (feasibility > 0.5) return "moderate";
  return "complex";
}

function ruleTypeToChangeType(
  ruleType: RuleType
): LabelChangeCostEstimate["changeType"] {
  switch (ruleType) {
    case "BAN":
    case "PHASE_OUT":
    case "MARKET_WITHDRAWAL":
      return "update_ingredients";
    case "WARNING_LABEL":
      return "add_warning";
    case "DISCLOSURE":
      return "new_disclosure";
    case "CONCENTRATION_LIMIT":
    case "CERTIFICATION":
      return "update_ingredients";
    case "REPORTING":
    case "INGREDIENT_REVIEW":
      return "remove_claim";
    default:
      return "update_ingredients";
  }
}

/**
 * Get the total revenue of products affected by an ingredient.
 */
async function getIngredientAffectedRevenue(
  ingredientId: string,
  tenantId: string
): Promise<number> {
  const items = await prisma.formulationItem.findMany({
    where: { ingredientId },
    include: {
      formulation: {
        include: {
          products: {
            where: { isCurrent: true },
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  let total = 0;
  for (const item of items) {
    for (const pf of item.formulation.products) {
      if (pf.product && pf.product.tenantId === tenantId && pf.product.isActive) {
        total += pf.product.annualRevenue?.toNumber() ?? 0;
      }
    }
  }
  return total;
}
