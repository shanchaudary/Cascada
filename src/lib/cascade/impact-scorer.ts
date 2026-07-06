// Cascada — Cascade Impact Scorer
// Computes severity, financial impact, and priority for each affected node
// in a cascade traversal. The impact score determines how urgently a
// regulatory change needs to be addressed and what resources to allocate.
//
// Scoring methodology:
// - Risk Score (0-1): How likely is this impact to materialize?
//   Based on edge strength, node risk, and regulation severity
// - Financial Impact ($): Estimated cost of the impact
//   Revenue at risk + reformulation cost + penalty exposure
// - Timeline Impact (days): How quickly must action be taken?
//   Based on compliance deadlines and grace periods
// - Reform Required (bool): Does this require product reformulation?
//   Based on impact type and rule type
//
// The composite score is: risk(0.4) + financial_normalized(0.3) + urgency(0.3)

import { prisma, withTenant } from "@/lib/db";
import { createCascadeLogger } from "@/lib/logger";
import { CASCADE_CONFIG } from "@/lib/constants";
import type {
  CascadeNodeType,
  ImpactType,
  Severity,
  TriggerStatus,
} from "@prisma/client";
import type {
  ImpactScore,
  CompositeImpactScore,
  TraversalResult,
} from "@/types/cascade";
import { daysUntilDeadline } from "@/utils/dates";

// ============================================================================
// Types
// ============================================================================

export interface ImpactScoringInput {
  triggerId: string;
  tenantId: string;
  traversalResult: TraversalResult;
  affectedNodeIds: string[];
}

export interface ImpactScoringResult {
  triggerId: string;
  nodeImpacts: ImpactScore[];
  compositeScore: CompositeImpactScore;
  impactRecords: Array<{
    nodeId: string;
    impactType: ImpactType;
    description: string;
    financialImpact: number | null;
    timelineImpactDays: number | null;
    reformRequired: boolean;
    reformCost: number | null;
    priority: number;
  }>;
}

// ============================================================================
// Scoring Constants
// ============================================================================

/** Financial impact thresholds for normalization (0-1 scale) */
const FINANCIAL_IMPACT_THRESHOLDS = {
  MIN: 10_000,       // $10K minimal impact
  LOW: 100_000,      // $100K low impact
  MEDIUM: 1_000_000, // $1M medium impact
  HIGH: 10_000_000,  // $10M high impact
  MAX: 100_000_000,  // $100M extreme impact
} as const;

/** Impact type to default severity mapping */
const IMPACT_SEVERITY_MAP: Record<ImpactType, Severity> = {
  REFORMULATION_REQUIRED: "HIGH",
  LABEL_CHANGE_REQUIRED: "MEDIUM",
  PRODUCT_WITHDRAWAL: "CRITICAL",
  REFORMULATION_COST: "HIGH",
  SUPPLY_CHAIN_DISRUPTION: "HIGH",
  CUSTOMER_SPEC_VIOLATION: "HIGH",
  REGULATORY_PENALTY: "CRITICAL",
  SHELF_SPACE_LOSS: "MEDIUM",
  MARKET_ACCESS_LOSS: "CRITICAL",
};

/** Impact type to financial impact range (min, max) in USD */
const IMPACT_FINANCIAL_RANGE: Record<ImpactType, { min: number; max: number }> = {
  REFORMULATION_REQUIRED: { min: 50_000, max: 5_000_000 },
  LABEL_CHANGE_REQUIRED: { min: 10_000, max: 500_000 },
  PRODUCT_WITHDRAWAL: { min: 500_000, max: 50_000_000 },
  REFORMULATION_COST: { min: 25_000, max: 2_000_000 },
  SUPPLY_CHAIN_DISRUPTION: { min: 100_000, max: 10_000_000 },
  CUSTOMER_SPEC_VIOLATION: { min: 50_000, max: 5_000_000 },
  REGULATORY_PENALTY: { min: 100_000, max: 100_000_000 },
  SHELF_SPACE_LOSS: { min: 200_000, max: 20_000_000 },
  MARKET_ACCESS_LOSS: { min: 500_000, max: 50_000_000 },
};

/** Impact types that require reformulation */
const REFORM_REQUIRED_IMPACT_TYPES: Set<ImpactType> = new Set([
  "REFORMULATION_REQUIRED",
  "REFORMULATION_COST",
]);

/** Node types that can determine impact type */
const NODE_IMPACT_TYPE_MAP: Record<CascadeNodeType, ImpactType[]> = {
  INGREDIENT: ["REFORMULATION_REQUIRED", "SUPPLY_CHAIN_DISRUPTION"],
  FORMULATION: ["REFORMULATION_REQUIRED", "REFORMULATION_COST"],
  PRODUCT: ["LABEL_CHANGE_REQUIRED", "PRODUCT_WITHDRAWAL", "MARKET_ACCESS_LOSS", "SHELF_SPACE_LOSS"],
  CUSTOMER: ["CUSTOMER_SPEC_VIOLATION"],
  REGULATION: ["REGULATORY_PENALTY"],
  RETAILER_REQUIREMENT: ["CUSTOMER_SPEC_VIOLATION", "SHELF_SPACE_LOSS"],
  SUPPLIER: ["SUPPLY_CHAIN_DISRUPTION"],
};

const logger = createCascadeLogger("impact-scorer");

// ============================================================================
// Impact Scoring Implementation
// ============================================================================

/**
 * Score the impact of a cascade trigger across all affected nodes.
 *
 * For each affected node:
 * 1. Determine the impact type based on node type and edge relationships
 * 2. Calculate financial impact based on product revenue, penalty amounts, etc.
 * 3. Calculate timeline impact based on compliance deadlines
 * 4. Compute reformulation requirement and estimated cost
 * 5. Derive overall risk score as a weighted composite
 *
 * Then compute a composite score across all impacts.
 */
export async function scoreCascadeImpact(
  input: ImpactScoringInput
): Promise<ImpactScoringResult> {
  const { triggerId, tenantId, traversalResult, affectedNodeIds } = input;

  logger.info(
    { triggerId, tenantId, affectedNodeCount: affectedNodeIds.length },
    "Starting cascade impact scoring"
  );

  try {
    return await withTenant(tenantId, async () => {
      const graph = await prisma.cascadeGraph.findFirst({
        where: { tenantId },
        orderBy: { version: "desc" },
      });

      if (!graph) {
        throw new Error("No cascade graph found for tenant");
      }

      // Get the trigger for deadline/compliance information
      const trigger = await prisma.cascadeTrigger.findUnique({
        where: { id: triggerId },
        include: {
          rule: {
            include: { source: true },
          },
        },
      });

      if (!trigger) {
        throw new Error(`Trigger ${triggerId} not found`);
      }

      // Load all affected nodes with their graph data
      const affectedNodes = await prisma.cascadeNode.findMany({
        where: {
          graphId: graph.id,
          id: { in: affectedNodeIds },
        },
      });

      // Score each affected node
      const nodeImpacts: ImpactScore[] = [];
      const impactRecords: ImpactScoringResult["impactRecords"] = [];

      for (const node of affectedNodes) {
        // Determine impact types for this node
        const impactTypes = NODE_IMPACT_TYPE_MAP[node.nodeType] ?? ["REFORMULATION_REQUIRED"];

        for (const impactType of impactTypes) {
          const impactScore = await scoreNodeImpact(
            node,
            impactType,
            trigger.rule.complianceDate,
            trigger.rule.penaltyAmount?.toNumber() ?? null,
            tenantId
          );

          nodeImpacts.push(impactScore);

          // Prepare impact record for database persistence
          impactRecords.push({
            nodeId: node.id,
            impactType,
            description: buildImpactDescription(node, impactType, trigger.title),
            financialImpact: impactScore.financialImpact > 0 ? impactScore.financialImpact : null,
            timelineImpactDays: impactScore.timelineImpactDays > 0 ? impactScore.timelineImpactDays : null,
            reformRequired: impactScore.reformRequired,
            reformCost: impactScore.reformCost,
            priority: calculatePriority(impactScore),
          });
        }
      }

      // Compute composite score across all node impacts
      const compositeScore = computeCompositeScore(triggerId, nodeImpacts);

      // Persist impact records to database
      for (const record of impactRecords) {
        await prisma.cascadeImpact.create({
          data: {
            triggerId,
            nodeId: record.nodeId,
            impactType: record.impactType,
            description: record.description,
            financialImpact: record.financialImpact,
            timelineImpact: record.timelineImpactDays,
            reformRequired: record.reformRequired,
            reformCost: record.reformCost,
            reformOptions: {},
            priority: record.priority,
          },
        });
      }

      // Update trigger with cost estimates and status
      await prisma.cascadeTrigger.update({
        where: { id: triggerId },
        data: {
          estimatedCostMin: compositeScore.totalFinancialImpact * 0.6,
          estimatedCostMax: compositeScore.totalFinancialImpact,
          status: "IMPACT_ASSESSED" as TriggerStatus,
        },
      });

      logger.info(
        {
          triggerId,
          nodeImpactCount: nodeImpacts.length,
          totalFinancialImpact: compositeScore.totalFinancialImpact,
          maxSeverity: compositeScore.maxSeverity,
          overallRiskScore: compositeScore.overallRiskScore,
        },
        "Cascade impact scoring completed"
      );

      return {
        triggerId,
        nodeImpacts,
        compositeScore,
        impactRecords,
      };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown impact scoring error";
    logger.error({ triggerId, error: msg }, "Impact scoring failed");
    throw error;
  }
}

/**
 * Score the impact for a single node.
 */
async function scoreNodeImpact(
  node: {
    id: string;
    nodeType: CascadeNodeType;
    entityId: string;
    label: string;
    properties: unknown;
    riskScore: { toNumber: () => number } | null;
  },
  impactType: ImpactType,
  complianceDate: Date | null,
  penaltyAmount: number | null,
  tenantId: string
): Promise<ImpactScore> {
  const nodeRisk = node.riskScore?.toNumber() ?? 0.5;
  const properties = node.properties as Record<string, unknown>;

  // Calculate probability based on node risk and impact severity
  const baseSeverity = IMPACT_SEVERITY_MAP[impactType];
  const severityMultiplier: Record<Severity, number> = {
    CRITICAL: 0.95,
    HIGH: 0.75,
    MEDIUM: 0.5,
    LOW: 0.25,
    INFO: 0.1,
  };
  const probability = Math.min(nodeRisk * severityMultiplier[baseSeverity] * 1.2, 1);

  // Calculate financial impact
  const financialImpact = await calculateFinancialImpact(
    { nodeType: node.nodeType, entityId: node.entityId, properties },
    impactType,
    properties,
    penaltyAmount,
    tenantId
  );

  // Calculate timeline impact
  const timelineImpactDays = calculateTimelineImpact(
    impactType,
    complianceDate,
    baseSeverity
  );

  // Determine if reformulation is required
  const reformRequired = REFORM_REQUIRED_IMPACT_TYPES.has(impactType);

  // Estimate reformulation cost if required
  const reformCost = reformRequired
    ? await estimateReformCost(node, tenantId)
    : null;

  // Compute overall risk score (weighted composite)
  const weights = CASCADE_CONFIG.RISK_WEIGHTS;
  const financialNormalized = normalizeFinancialImpact(financialImpact);
  const urgencyScore = normalizeUrgency(timelineImpactDays);

  const overallRiskScore = Math.min(
    (nodeRisk * weights.SEVERITY) +
    (financialNormalized * weights.FINANCIAL_IMPACT) +
    (urgencyScore * weights.TIMELINE_URGENCY) +
    (nodeRisk * weights.BREATH),
    1
  );

  return {
    nodeId: node.id,
    nodeType: node.nodeType,
    entityId: node.entityId,
    label: node.label,
    impactType,
    financialImpact,
    timelineImpactDays,
    severity: baseSeverity,
    probability,
    reformRequired,
    reformCost,
    overallRiskScore,
  };
}

/**
 * Calculate the financial impact for a node based on its type and data.
 */
async function calculateFinancialImpact(
  node: { nodeType: CascadeNodeType; entityId: string; properties: Record<string, unknown> },
  impactType: ImpactType,
  properties: Record<string, unknown>,
  penaltyAmount: number | null,
  tenantId: string
): Promise<number> {
  const range = IMPACT_FINANCIAL_RANGE[impactType];

  switch (node.nodeType) {
    case "PRODUCT": {
      // Financial impact based on product annual revenue
      const annualRevenue = properties['annualRevenue'] as number | undefined;
      if (annualRevenue) {
        // Impact is proportional to revenue: worst case is full revenue loss
        // More typical is 10-30% revenue at risk depending on impact type
        const revenueMultiplier: Record<ImpactType, number> = {
          PRODUCT_WITHDRAWAL: 1.0,
          MARKET_ACCESS_LOSS: 0.5,
          SHELF_SPACE_LOSS: 0.3,
          LABEL_CHANGE_REQUIRED: 0.05,
          REFORMULATION_REQUIRED: 0.1,
          REFORMULATION_COST: 0.05,
          CUSTOMER_SPEC_VIOLATION: 0.2,
          REGULATORY_PENALTY: 0.1,
          SUPPLY_CHAIN_DISRUPTION: 0.15,
        };
        return Math.min(annualRevenue * (revenueMultiplier[impactType] ?? 0.1), range.max);
      }
      // Default if no revenue data
      return range.min;
    }
    case "CUSTOMER": {
      // Customer impact: sum of revenue from all products sold to this customer
      const customerProducts = await prisma.customerProduct.findMany({
        where: { customerId: node.entityId, isActive: true },
        include: { product: true },
      });
      const customerRevenue = customerProducts.reduce(
        (sum, cp) => sum + (cp.product.annualRevenue?.toNumber() ?? 0),
        0
      );
      return Math.min(customerRevenue * 0.2, range.max);
    }
    case "REGULATION": {
      // Regulation impact: penalty amount or default range
      if (penaltyAmount) {
        return Math.min(penaltyAmount * 10, range.max); // 10x penalty for total exposure estimate
      }
      return range.min;
    }
    case "INGREDIENT":
    case "FORMULATION": {
      // Ingredient/formulation impact: based on affected product revenues
      const productRevenue = await estimateAffectedProductRevenue(node, tenantId);
      const multiplier = impactType === "REFORMULATION_REQUIRED" ? 0.1 : 0.05;
      return Math.min(productRevenue * multiplier, range.max);
    }
    default:
      return range.min;
  }
}

/**
 * Estimate total revenue of products affected by an ingredient or formulation change.
 */
async function estimateAffectedProductRevenue(
  node: { nodeType: CascadeNodeType; entityId: string },
  tenantId: string
): Promise<number> {
  if (node.nodeType === "FORMULATION") {
    const products = await prisma.productFormulation.findMany({
      where: { formulationId: node.entityId, isCurrent: true },
      include: { product: true },
    });
    return products.reduce((sum, pf) => {
      if (pf.product && pf.product.tenantId === tenantId && pf.product.isActive) {
        return sum + (pf.product.annualRevenue?.toNumber() ?? 0);
      }
      return sum;
    }, 0);
  }

  if (node.nodeType === "INGREDIENT") {
    const items = await prisma.formulationItem.findMany({
      where: { ingredientId: node.entityId },
      include: {
        formulation: {
          include: {
            products: {
              where: { isCurrent: true },
              include: { product: true },
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

  return 0;
}

/**
 * Calculate timeline impact in days.
 */
function calculateTimelineImpact(
  impactType: ImpactType,
  complianceDate: Date | null,
  severity: Severity
): number {
  // If there's a compliance date, calculate days until then
  if (complianceDate) {
    const days = daysUntilDeadline(complianceDate);
    if (days !== null) {
      return Math.max(days, 0);
    }
  }

  // Default timeline by severity
  const defaultTimelines: Record<Severity, number> = {
    CRITICAL: CASCADE_CONFIG.SEVERITY_DEADLINE_DAYS.CRITICAL,
    HIGH: CASCADE_CONFIG.SEVERITY_DEADLINE_DAYS.HIGH,
    MEDIUM: CASCADE_CONFIG.SEVERITY_DEADLINE_DAYS.MEDIUM,
    LOW: CASCADE_CONFIG.SEVERITY_DEADLINE_DAYS.LOW,
    INFO: CASCADE_CONFIG.SEVERITY_DEADLINE_DAYS.INFO,
  };

  return defaultTimelines[severity];
}

/**
 * Estimate reformulation cost for an ingredient or formulation.
 */
async function estimateReformCost(
  node: { nodeType: CascadeNodeType; entityId: string },
  tenantId: string
): Promise<number> {
  // Base reformulation cost components:
  // - R&D testing: $25K-$200K
  // - Regulatory filing: $10K-$100K
  // - Production line changeover: $5K-$50K
  // - Market testing: $10K-$50K
  // Total range: ~$50K-$400K per reformulation

  const productRevenue = await estimateAffectedProductRevenue(node, tenantId);

  // Scale reformulation cost with product revenue (more revenue = more complex reformulation)
  if (productRevenue > 10_000_000) return 400_000;
  if (productRevenue > 1_000_000) return 200_000;
  if (productRevenue > 100_000) return 100_000;
  return 50_000;
}

/**
 * Normalize a financial impact amount to a 0-1 scale.
 */
function normalizeFinancialImpact(amount: number): number {
  if (amount <= FINANCIAL_IMPACT_THRESHOLDS.MIN) return 0.1;
  if (amount <= FINANCIAL_IMPACT_THRESHOLDS.LOW) return 0.2;
  if (amount <= FINANCIAL_IMPACT_THRESHOLDS.MEDIUM) return 0.4;
  if (amount <= FINANCIAL_IMPACT_THRESHOLDS.HIGH) return 0.6;
  if (amount <= FINANCIAL_IMPACT_THRESHOLDS.MAX) return 0.8;
  return 1.0;
}

/**
 * Normalize timeline urgency to a 0-1 scale.
 * Shorter timeline = higher urgency = higher score.
 */
function normalizeUrgency(days: number): number {
  if (days <= 7) return 1.0;
  if (days <= 30) return 0.8;
  if (days <= 90) return 0.5;
  if (days <= 180) return 0.3;
  if (days <= 365) return 0.15;
  return 0.05;
}

/**
 * Calculate priority (1-10) from an impact score.
 */
function calculatePriority(impact: ImpactScore): number {
  return Math.round(
    impact.overallRiskScore * 5 +
    (impact.reformRequired ? 3 : 0) +
    (impact.financialImpact > 1_000_000 ? 2 : 0)
  );
}

/**
 * Compute the composite impact score across all node impacts.
 */
function computeCompositeScore(
  triggerId: string,
  nodeImpacts: ImpactScore[]
): CompositeImpactScore {
  const totalFinancialImpact = nodeImpacts.reduce((sum, i) => sum + i.financialImpact, 0);

  // Count unique affected SKUs (PRODUCT nodes)
  const productImpacts = nodeImpacts.filter((i) => i.nodeType === "PRODUCT");
  const uniqueProductIds = new Set(productImpacts.map((i) => i.entityId));
  const totalSkusAffected = uniqueProductIds.size;

  // Total revenue at risk: sum of financial impacts on PRODUCT nodes
  const totalRevenueAtRisk = productImpacts.reduce((sum, i) => sum + i.financialImpact, 0);

  // Max depth from traversal
  const maxDepth = Math.max(...nodeImpacts.map((i) => i.overallRiskScore), 0);

  // Maximum severity
  const severityOrder: Severity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const maxSeverity = nodeImpacts.reduce<Severity>((max, impact) => {
    return severityOrder.indexOf(impact.severity) > severityOrder.indexOf(max)
      ? impact.severity
      : max;
  }, "INFO");

  // Impact by type
  const impactByType = {} as Record<ImpactType, number>;
  for (const impact of nodeImpacts) {
    impactByType[impact.impactType] = (impactByType[impact.impactType] ?? 0) + 1;
  }

  // Impact by node type
  const impactByNodeType = {} as Record<CascadeNodeType, number>;
  for (const impact of nodeImpacts) {
    impactByNodeType[impact.nodeType] = (impactByNodeType[impact.nodeType] ?? 0) + 1;
  }

  // Overall risk score: weighted average of all node risk scores
  const overallRiskScore = nodeImpacts.length > 0
    ? nodeImpacts.reduce((sum, i) => sum + i.overallRiskScore, 0) / nodeImpacts.length
    : 0;

  return {
    triggerId,
    totalFinancialImpact,
    totalSkusAffected,
    totalRevenueAtRisk,
    maxDepth: Math.round(maxDepth * 10), // Scale to integer
    maxSeverity,
    impactByType,
    impactByNodeType,
    overallRiskScore,
  };
}

/**
 * Build a human-readable description for an impact.
 */
function buildImpactDescription(
  node: { nodeType: CascadeNodeType; label: string },
  impactType: ImpactType,
  triggerTitle: string
): string {
  const typeDescriptions: Record<ImpactType, string> = {
    REFORMULATION_REQUIRED: `Product reformulation required for "${node.label}" due to ${triggerTitle}`,
    LABEL_CHANGE_REQUIRED: `Label change required for "${node.label}" due to ${triggerTitle}`,
    PRODUCT_WITHDRAWAL: `Product withdrawal may be required for "${node.label}" due to ${triggerTitle}`,
    REFORMULATION_COST: `Reformulation cost impact on "${node.label}" from ${triggerTitle}`,
    SUPPLY_CHAIN_DISRUPTION: `Supply chain disruption risk for "${node.label}" from ${triggerTitle}`,
    CUSTOMER_SPEC_VIOLATION: `Customer specification violation risk for "${node.label}" from ${triggerTitle}`,
    REGULATORY_PENALTY: `Regulatory penalty exposure for "${node.label}" from ${triggerTitle}`,
    SHELF_SPACE_LOSS: `Shelf space loss risk for "${node.label}" due to ${triggerTitle}`,
    MARKET_ACCESS_LOSS: `Market access loss risk for "${node.label}" due to ${triggerTitle}`,
  };

  return typeDescriptions[impactType] ?? `Impact on "${node.label}" from ${triggerTitle}`;
}

/**
 * Get all impacts for a specific trigger.
 */
export async function getTriggerImpacts(
  tenantId: string,
  triggerId: string
): Promise<Array<{
  id: string;
  nodeId: string;
  impactType: ImpactType;
  description: string;
  financialImpact: number | null;
  timelineImpact: number | null;
  reformRequired: boolean;
  reformCost: number | null;
  priority: number | null;
  nodeLabel: string;
  nodeType: CascadeNodeType;
}>> {
  return withTenant(tenantId, async () => {
    // Verify trigger belongs to tenant
    const trigger = await prisma.cascadeTrigger.findUnique({
      where: { id: triggerId },
      include: { graph: { select: { tenantId: true } } },
    });

    if (!trigger || trigger.graph.tenantId !== tenantId) return [];

    const impacts = await prisma.cascadeImpact.findMany({
      where: { triggerId },
      include: {
        node: { select: { label: true, nodeType: true } },
      },
      orderBy: { priority: "desc" },
    });

    return impacts.map((i) => ({
      id: i.id,
      nodeId: i.nodeId,
      impactType: i.impactType,
      description: i.description,
      financialImpact: i.financialImpact?.toNumber() ?? null,
      timelineImpact: i.timelineImpact,
      reformRequired: i.reformRequired,
      reformCost: i.reformCost?.toNumber() ?? null,
      priority: i.priority,
      nodeLabel: i.node.label,
      nodeType: i.node.nodeType,
    }));
  });
}
