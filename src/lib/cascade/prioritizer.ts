// Cascada — Cascade Prioritizer
// Ranks cascade triggers by Risk × Impact × Urgency to help the C-suite
// decide what to address first.
//
// The prioritization model:
//   compositeScore = riskScore * 0.4 + impactScore * 0.3 + urgencyScore * 0.3
//
// Risk Score (0-1): How likely is this cascade to cause actual harm?
//   Based on: severity, probability of enforcement, number of matched substances
//
// Impact Score (0-1): How much financial/exposure damage?
//   Based on: SKUs affected, revenue at risk, customer count, reformulation need
//
// Urgency Score (0-1): How soon must we act?
//   Based on: days until deadline, grace period remaining, escalation trajectory
//
// The prioritizer sorts all active triggers and assigns ranks.
// Higher compositeScore = higher priority = act first.

import { prisma, withTenant } from "@/lib/db";
import { createCascadeLogger } from "@/lib/logger";
import { CASCADE_CONFIG } from "@/lib/constants";
import type {
  Severity,
  TriggerType,
  TriggerStatus,
} from "@prisma/client";
import type { PrioritizedTrigger } from "@/types/cascade";
import { daysUntilDeadline } from "@/utils/dates";

// ============================================================================
// Types
// ============================================================================

export interface PrioritizationInput {
  tenantId: string;
  statusFilter?: TriggerStatus[];
  severityFilter?: Severity[];
}

export interface PrioritizationResult {
  triggers: PrioritizedTrigger[];
  totalTriggers: number;
  criticalCount: number;
  highCount: number;
  averageRiskScore: number;
  averageImpactScore: number;
  averageUrgencyScore: number;
}

// ============================================================================
// Scoring Constants
// ============================================================================

/** Severity to base risk score mapping */
const SEVERITY_RISK_SCORE: Record<Severity, number> = {
  CRITICAL: 1.0,
  HIGH: 0.75,
  MEDIUM: 0.5,
  LOW: 0.25,
  INFO: 0.1,
};

/** Trigger type enforcement probability */
const ENFORCEMENT_PROBABILITY: Record<TriggerType, number> = {
  NEW_REGULATION: 0.85,
  REGULATION_AMENDMENT: 0.7,
  REGULATION_REPEAL: 0.1, // Repeals reduce risk
  RETAILER_MANDATE_CHANGE: 0.95, // Retailers enforce aggressively
  SUPPLIER_DISRUPTION: 0.6,
  INGREDIENT_SHORTAGE: 0.5,
};

/** SKU count to impact score mapping */
const SKU_IMPACT_THRESHOLDS = {
  MINIMAL: 5,    // 1-5 SKUs
  LOW: 20,       // 6-20 SKUs
  MODERATE: 50,  // 21-50 SKUs
  HIGH: 100,     // 51-100 SKUs
  EXTREME: 100,  // 100+ SKUs
} as const;

/** Revenue at risk to impact score mapping */
const REVENUE_IMPACT_THRESHOLDS = {
  MINIMAL: 100_000,
  LOW: 500_000,
  MODERATE: 2_000_000,
  HIGH: 10_000_000,
  EXTREME: 50_000_000,
} as const;

/** Days until deadline to urgency score mapping */
const URGENCY_THRESHOLDS = {
  OVERDUE: 0,
  CRITICAL: 7,
  URGENT: 30,
  MODERATE: 90,
  LOW: 180,
  DISTANT: 365,
} as const;

const logger = createCascadeLogger("prioritizer");

// ============================================================================
// Prioritizer Implementation
// ============================================================================

/**
 * Prioritize all active cascade triggers for a tenant.
 *
 * Returns triggers sorted by composite score (highest first),
 * with individual risk/impact/urgency scores computed for each.
 */
export async function prioritizeTriggers(
  input: PrioritizationInput
): Promise<PrioritizationResult> {
  const { tenantId, statusFilter, severityFilter } = input;

  logger.info({ tenantId }, "Starting trigger prioritization");

  try {
    return await withTenant(tenantId, async () => {
      // Get all cascade graphs for the tenant
      const graphs = await prisma.cascadeGraph.findMany({
        where: { tenantId },
        select: { id: true },
      });

      if (graphs.length === 0) {
        return {
          triggers: [],
          totalTriggers: 0,
          criticalCount: 0,
          highCount: 0,
          averageRiskScore: 0,
          averageImpactScore: 0,
          averageUrgencyScore: 0,
        };
      }

      const graphIds = graphs.map((g) => g.id);

      // Fetch triggers with their impacts for scoring
      const triggers = await prisma.cascadeTrigger.findMany({
        where: {
          graphId: { in: graphIds },
          status: { notIn: ["COMPLETED", "DISMISSED"] },
          ...(statusFilter && { status: { in: statusFilter } }),
          ...(severityFilter && { severity: { in: severityFilter } }),
        },
        include: {
          impacts: true,
        },
        orderBy: { createdAt: "desc" },
      });

      // Score each trigger
      const scoredTriggers: PrioritizedTrigger[] = [];

      for (const trigger of triggers) {
        const riskScore = computeRiskScore(trigger);
        const impactScore = await computeImpactScore(trigger, tenantId);
        const urgencyScore = computeUrgencyScore(trigger);

        const compositeScore =
          riskScore * CASCADE_CONFIG.RISK_WEIGHTS.SEVERITY +
          impactScore * CASCADE_CONFIG.RISK_WEIGHTS.FINANCIAL_IMPACT +
          urgencyScore * CASCADE_CONFIG.RISK_WEIGHTS.TIMELINE_URGENCY;

        const daysRemaining = trigger.deadlineDate ? daysUntilDeadline(trigger.deadlineDate) : null;

        scoredTriggers.push({
          triggerId: trigger.id,
          title: trigger.title,
          severity: trigger.severity,
          triggerType: trigger.triggerType,
          status: trigger.status,
          totalSkusAffected: trigger.totalSkusAffected,
          estimatedCostMin: trigger.estimatedCostMin?.toNumber() ?? null,
          estimatedCostMax: trigger.estimatedCostMax?.toNumber() ?? null,
          deadlineDate: trigger.deadlineDate?.toISOString() ?? null,
          daysUntilDeadline: daysRemaining,
          riskScore,
          impactScore,
          urgencyScore,
          compositeScore,
          rank: 0, // Will be assigned after sorting
        });
      }

      // Sort by composite score (highest first)
      scoredTriggers.sort((a, b) => b.compositeScore - a.compositeScore);

      // Assign ranks
      for (let i = 0; i < scoredTriggers.length; i++) {
        const trigger = scoredTriggers[i];
        if (trigger) trigger.rank = i + 1;
      }

      // Compute summary statistics
      const criticalCount = scoredTriggers.filter(
        (t) => t.severity === "CRITICAL"
      ).length;
      const highCount = scoredTriggers.filter(
        (t) => t.severity === "HIGH"
      ).length;

      const totalTriggers = scoredTriggers.length;
      const averageRiskScore = totalTriggers > 0
        ? scoredTriggers.reduce((s, t) => s + t.riskScore, 0) / totalTriggers
        : 0;
      const averageImpactScore = totalTriggers > 0
        ? scoredTriggers.reduce((s, t) => s + t.impactScore, 0) / totalTriggers
        : 0;
      const averageUrgencyScore = totalTriggers > 0
        ? scoredTriggers.reduce((s, t) => s + t.urgencyScore, 0) / totalTriggers
        : 0;

      logger.info(
        {
          tenantId,
          totalTriggers,
          criticalCount,
          highCount,
          averageCompositeScore: totalTriggers > 0
            ? scoredTriggers.reduce((s, t) => s + t.compositeScore, 0) / totalTriggers
            : 0,
        },
        "Trigger prioritization completed"
      );

      return {
        triggers: scoredTriggers,
        totalTriggers,
        criticalCount,
        highCount,
        averageRiskScore,
        averageImpactScore,
        averageUrgencyScore,
      };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown prioritization error";
    logger.error({ tenantId, error: msg }, "Prioritization failed");
    throw error;
  }
}

// ============================================================================
// Score Computation
// ============================================================================

/**
 * Compute risk score (0-1) for a trigger.
 * Risk represents the probability that this cascade will cause actual harm.
 *
 * Factors:
 * - Severity of the trigger (CRITICAL = highest risk)
 * - Enforcement probability by trigger type
 * - Number of matched substances (more matches = higher risk)
 * - Whether any impact has been assessed
 */
function computeRiskScore(trigger: {
  severity: Severity;
  triggerType: TriggerType;
  impacts: Array<{ priority: number | null }>;
}): number {
  const baseRisk = SEVERITY_RISK_SCORE[trigger.severity];
  const enforcementProbability = ENFORCEMENT_PROBABILITY[trigger.triggerType];

  // If impacts have been scored, use the average priority as a risk boost
  let impactRiskBoost = 0;
  if (trigger.impacts.length > 0) {
    const avgPriority = trigger.impacts.reduce(
      (sum, i) => sum + (i.priority ?? 0.5),
      0
    ) / trigger.impacts.length;
    impactRiskBoost = (avgPriority / 10) * 0.2; // Normalize priority (1-10) to 0-1 range
  }

  // Composite: base risk weighted by enforcement probability, boosted by impact assessment
  const riskScore = (baseRisk * enforcementProbability) + impactRiskBoost;
  return Math.min(riskScore, 1);
}

/**
 * Compute impact score (0-1) for a trigger.
 * Impact represents the magnitude of financial and operational damage.
 *
 * Factors:
 * - Number of SKUs affected
 * - Estimated cost range (min-max)
 * - Number of distinct impact types
 * - Whether reformulation is required (higher impact than label changes)
 */
async function computeImpactScore(
  trigger: {
    totalSkusAffected: number;
    estimatedCostMin: { toNumber: () => number } | null;
    estimatedCostMax: { toNumber: () => number } | null;
    impacts: Array<{
      impactType: string;
      reformRequired: boolean;
      financialImpact: { toNumber: () => number } | null;
    }>;
  },
  tenantId: string
): Promise<number> {
  // SKU-based impact score
  const skuScore = computeSkuImpactScore(trigger.totalSkusAffected);

  // Cost-based impact score
  const estimatedCostMax = trigger.estimatedCostMax?.toNumber() ?? 0;
  const costScore = computeCostImpactScore(estimatedCostMax);

  // Impact type diversity score
  const impactTypes = new Set(trigger.impacts.map((i) => i.impactType));
  const diversityScore = Math.min(impactTypes.size / 5, 1); // 5+ types = max

  // Reformulation weight (reformulation is more impactful than labeling)
  const hasReformulation = trigger.impacts.some((i) => i.reformRequired);
  const reformWeight = hasReformulation ? 0.15 : 0;

  // Total financial impact from assessed impacts
  const totalFinancialImpact = trigger.impacts.reduce(
    (sum, i) => sum + (i.financialImpact?.toNumber() ?? 0),
    0
  );
  const financialScore = computeRevenueImpactScore(totalFinancialImpact);

  // Weighted composite
  const impactScore =
    skuScore * 0.25 +
    costScore * 0.25 +
    diversityScore * 0.15 +
    financialScore * 0.25 +
    reformWeight + // Direct additive
    0.1; // Base impact floor

  return Math.min(impactScore, 1);
}

/**
 * Compute urgency score (0-1) for a trigger.
 * Urgency represents how quickly action must be taken.
 *
 * Factors:
 * - Days until deadline (fewer = more urgent)
 * - Grace period remaining
 * - Whether the deadline has already passed
 */
function computeUrgencyScore(trigger: {
  deadlineDate: Date | null;
  severity: Severity;
}): number {
  if (!trigger.deadlineDate) {
    // No deadline: use severity-based default urgency
    return SEVERITY_RISK_SCORE[trigger.severity] * 0.3;
  }

  const daysRemaining = daysUntilDeadline(trigger.deadlineDate);

  if (daysRemaining === null) {
    return 0.5;
  }

  // Overdue = maximum urgency
  if (daysRemaining < 0) return 1.0;

  // Urgency mapping based on days remaining
  if (daysRemaining <= URGENCY_THRESHOLDS.CRITICAL) return 1.0;
  if (daysRemaining <= URGENCY_THRESHOLDS.URGENT) return 0.85;
  if (daysRemaining <= URGENCY_THRESHOLDS.MODERATE) return 0.6;
  if (daysRemaining <= URGENCY_THRESHOLDS.LOW) return 0.35;
  if (daysRemaining <= URGENCY_THRESHOLDS.DISTANT) return 0.15;
  return 0.05;
}

/**
 * Compute SKU-based impact score.
 */
function computeSkuImpactScore(skuCount: number): number {
  if (skuCount === 0) return 0;
  if (skuCount <= SKU_IMPACT_THRESHOLDS.MINIMAL) return 0.15;
  if (skuCount <= SKU_IMPACT_THRESHOLDS.LOW) return 0.3;
  if (skuCount <= SKU_IMPACT_THRESHOLDS.MODERATE) return 0.5;
  if (skuCount <= SKU_IMPACT_THRESHOLDS.HIGH) return 0.7;
  return 0.9; // 100+ SKUs
}

/**
 * Compute cost-based impact score.
 */
function computeCostImpactScore(estimatedCostMax: number): number {
  if (estimatedCostMax <= 0) return 0;
  if (estimatedCostMax <= REVENUE_IMPACT_THRESHOLDS.MINIMAL) return 0.1;
  if (estimatedCostMax <= REVENUE_IMPACT_THRESHOLDS.LOW) return 0.3;
  if (estimatedCostMax <= REVENUE_IMPACT_THRESHOLDS.MODERATE) return 0.5;
  if (estimatedCostMax <= REVENUE_IMPACT_THRESHOLDS.HIGH) return 0.7;
  if (estimatedCostMax <= REVENUE_IMPACT_THRESHOLDS.EXTREME) return 0.85;
  return 1.0;
}

/**
 * Compute revenue-based impact score.
 */
function computeRevenueImpactScore(revenueAtRisk: number): number {
  if (revenueAtRisk <= 0) return 0;
  if (revenueAtRisk <= REVENUE_IMPACT_THRESHOLDS.MINIMAL) return 0.1;
  if (revenueAtRisk <= REVENUE_IMPACT_THRESHOLDS.LOW) return 0.25;
  if (revenueAtRisk <= REVENUE_IMPACT_THRESHOLDS.MODERATE) return 0.45;
  if (revenueAtRisk <= REVENUE_IMPACT_THRESHOLDS.HIGH) return 0.65;
  return 0.9;
}

/**
 * Get a summary of exposure by state/jurisdiction for a tenant.
 * This is used for the dashboard and for the diagnostic report.
 */
export async function getExposureByJurisdiction(
  tenantId: string
): Promise<Array<{
  jurisdiction: string;
  triggerCount: number;
  skuCount: number;
  estimatedCostMin: number;
  estimatedCostMax: number;
  maxSeverity: Severity;
  regulations: string[];
}>> {
  return withTenant(tenantId, async () => {
    const graphs = await prisma.cascadeGraph.findMany({
      where: { tenantId },
      select: { id: true },
    });

    if (graphs.length === 0) return [];

    const triggers = await prisma.cascadeTrigger.findMany({
      where: {
        graphId: { in: graphs.map((g) => g.id) },
        status: { notIn: ["COMPLETED", "DISMISSED"] },
      },
      include: {
        rule: {
          include: { source: true },
        },
      },
    });

    // Group by jurisdiction
    const byJurisdiction = new Map<string, {
      triggerCount: number;
      skuCount: number;
      estimatedCostMin: number;
      estimatedCostMax: number;
      maxSeverity: Severity;
      regulations: Set<string>;
    }>();

    const severityOrder: Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

    for (const trigger of triggers) {
      const jurisdiction = trigger.rule.jurisdiction;

      if (!byJurisdiction.has(jurisdiction)) {
        byJurisdiction.set(jurisdiction, {
          triggerCount: 0,
          skuCount: 0,
          estimatedCostMin: 0,
          estimatedCostMax: 0,
          maxSeverity: "INFO",
          regulations: new Set(),
        });
      }

      const entry = byJurisdiction.get(jurisdiction)!;
      entry.triggerCount++;
      entry.skuCount += trigger.totalSkusAffected;
      entry.estimatedCostMin += trigger.estimatedCostMin?.toNumber() ?? 0;
      entry.estimatedCostMax += trigger.estimatedCostMax?.toNumber() ?? 0;
      entry.regulations.add(trigger.rule.source.name);

      // Update max severity
      if (severityOrder.indexOf(trigger.severity) > severityOrder.indexOf(entry.maxSeverity)) {
        entry.maxSeverity = trigger.severity;
      }
    }

    return Array.from(byJurisdiction.entries()).map(([jurisdiction, data]) => ({
      jurisdiction,
      triggerCount: data.triggerCount,
      skuCount: data.skuCount,
      estimatedCostMin: data.estimatedCostMin,
      estimatedCostMax: data.estimatedCostMax,
      maxSeverity: data.maxSeverity,
      regulations: Array.from(data.regulations),
    }));
  });
}

/**
 * Get a summary of exposure by product for a tenant.
 */
export async function getExposureByProduct(
  tenantId: string
): Promise<Array<{
  productId: string;
  productName: string;
  sku: string;
  triggerCount: number;
  estimatedCostMax: number;
  maxSeverity: Severity;
  affectedJurisdictions: string[];
}>> {
  return withTenant(tenantId, async () => {
    const graphs = await prisma.cascadeGraph.findMany({
      where: { tenantId },
      select: { id: true },
    });

    if (graphs.length === 0) return [];

    // Find PRODUCT nodes that are affected by triggers
    const triggers = await prisma.cascadeTrigger.findMany({
      where: {
        graphId: { in: graphs.map((g) => g.id) },
        status: { notIn: ["COMPLETED", "DISMISSED"] },
      },
      include: {
        rule: true,
        impacts: {
          where: { node: { nodeType: "PRODUCT" } },
          include: { node: true },
        },
      },
    });

    const byProduct = new Map<string, {
      productId: string;
      productName: string;
      sku: string;
      triggerCount: number;
      estimatedCostMax: number;
      maxSeverity: Severity;
      affectedJurisdictions: Set<string>;
    }>();

    const severityOrder: Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

    for (const trigger of triggers) {
      for (const impact of trigger.impacts) {
        const productId = impact.node.entityId;

        // Fetch product details if not already cached
        if (!byProduct.has(productId)) {
          const product = await prisma.product.findUnique({
            where: { id: productId },
          });

          if (!product) continue;

          byProduct.set(productId, {
            productId,
            productName: product.name,
            sku: product.sku,
            triggerCount: 0,
            estimatedCostMax: 0,
            maxSeverity: "INFO",
            affectedJurisdictions: new Set(),
          });
        }

        const entry = byProduct.get(productId)!;
        entry.triggerCount++;
        entry.estimatedCostMax += impact.financialImpact?.toNumber() ?? 0;
        entry.affectedJurisdictions.add(trigger.rule.jurisdiction);

        if (severityOrder.indexOf(trigger.severity) > severityOrder.indexOf(entry.maxSeverity)) {
          entry.maxSeverity = trigger.severity;
        }
      }
    }

    return Array.from(byProduct.values()).map((entry) => ({
      ...entry,
      affectedJurisdictions: Array.from(entry.affectedJurisdictions),
    })).sort(
      (a, b) => b.estimatedCostMax - a.estimatedCostMax
    );
  });
}
