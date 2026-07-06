// Cascada — Compliance Timeline & Conflict Detection
// Builds a compliance timeline from cascade trigger data and detects
// conflicting deadlines across jurisdictions.
//
// The timeline module answers two critical questions:
// 1. When do we need to comply? (deadline tracking)
// 2. Are there conflicting deadlines across jurisdictions? (conflict detection)
//
// Conflict scenarios:
// - CA AB 418 bans Red Dye 40 effective Jan 1, 2027
// - TX SB 25 requires labeling disclosure effective Mar 1, 2027
// - If you reformulate for CA, you don't need the TX label change
// - But if you only label for TX, you can't sell in CA
// - The timeline module surfaces these conflicts so the C-suite can decide
//
// Timeline events include: regulation effective dates, compliance deadlines,
// grace period endings, review deadlines, and contract expirations.

import { prisma, withTenant } from "@/lib/db";
import { createCascadeLogger } from "@/lib/logger";
import { CASCADE_CONFIG } from "@/lib/constants";
import type {
  Severity,
  TriggerType,
} from "@prisma/client";
import type {
  ComplianceTimeline,
  TimelineEvent,
  TimelineConflict,
} from "@/types/cascade";
import { daysBetween, daysUntilDeadline } from "@/utils/dates";

// ============================================================================
// Types
// ============================================================================

export interface TimelineBuildInput {
  triggerId: string;
  tenantId: string;
  affectedNodeIds: string[];
}

export interface ConflictDetectionResult {
  hasConflicts: boolean;
  conflicts: TimelineConflict[];
  conflictingJurisdictions: string[];
  recommendedResolution: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum overlap in days to flag as a deadline conflict */
const CONFLICT_OVERLAP_DAYS = 90;

/** Severity escalation for overlapping deadlines */
const CONFLICT_SEVERITY_ESCALATION: Record<Severity, Severity> = {
  INFO: "LOW",
  LOW: "MEDIUM",
  MEDIUM: "HIGH",
  HIGH: "CRITICAL",
  CRITICAL: "CRITICAL",
};

const logger = createCascadeLogger("timeline");

// ============================================================================
// Timeline Builder Implementation
// ============================================================================

/**
 * Build a compliance timeline for a cascade trigger.
 *
 * The timeline includes:
 * - Regulation effective dates
 * - Compliance deadlines (with grace periods)
 * - Review/assessment deadlines
 * - Contract expiry dates (for affected customer relationships)
 * - Conflict detection between jurisdictions
 */
export async function buildComplianceTimeline(
  input: TimelineBuildInput
): Promise<ComplianceTimeline> {
  const { triggerId, tenantId, affectedNodeIds } = input;

  logger.info({ triggerId, tenantId, affectedNodeCount: affectedNodeIds.length }, "Building compliance timeline");

  try {
    return await withTenant(tenantId, async () => {
      const trigger = await prisma.cascadeTrigger.findUnique({
        where: { id: triggerId },
        include: {
          rule: {
            include: {
              source: true,
              substances: true,
            },
          },
          impacts: {
            include: { node: true },
          },
        },
      });

      if (!trigger) {
        throw new Error(`Trigger ${triggerId} not found`);
      }

      const events: TimelineEvent[] = [];
      const rule = trigger.rule;

      // Event 1: Regulation effective date
      if (rule.effectiveDate) {
        events.push({
          date: rule.effectiveDate.toISOString(),
          type: "regulation_effective",
          description: `${rule.source.name} becomes effective`,
          jurisdiction: rule.jurisdiction,
          severity: mapRuleTypeToSeverity(rule.ruleType),
          affectedNodeIds: trigger.affectedNodeIds,
        });
      }

      // Event 2: Compliance deadline
      if (rule.complianceDate) {
        events.push({
          date: rule.complianceDate.toISOString(),
          type: "compliance_deadline",
          description: `Compliance deadline for ${rule.source.name}`,
          jurisdiction: rule.jurisdiction,
          severity: "HIGH",
          affectedNodeIds: trigger.affectedNodeIds,
        });
      }

      // Event 3: Grace period end
      if (rule.complianceDate && rule.gracePeriodDays) {
        const graceEnd = new Date(rule.effectiveDate ?? rule.complianceDate);
        graceEnd.setDate(graceEnd.getDate() + rule.gracePeriodDays);
        events.push({
          date: graceEnd.toISOString(),
          type: "grace_period_end",
          description: `Grace period ends for ${rule.source.name} (${rule.gracePeriodDays} days)`,
          jurisdiction: rule.jurisdiction,
          severity: "CRITICAL",
          affectedNodeIds: trigger.affectedNodeIds,
        });
      }

      // Event 4: Review/assessment deadline (60 days before compliance)
      if (rule.complianceDate) {
        const reviewDate = new Date(rule.complianceDate);
        reviewDate.setDate(reviewDate.getDate() - 60);
        events.push({
          date: reviewDate.toISOString(),
          type: "review_deadline",
          description: `Assessment review deadline for ${rule.source.name} (60 days before compliance)`,
          jurisdiction: rule.jurisdiction,
          severity: "MEDIUM",
          affectedNodeIds: trigger.affectedNodeIds,
        });
      }

      // Event 5: Contract expiry dates for affected customers
      const customerNodes = trigger.impacts.filter(
        (i) => i.node.nodeType === "CUSTOMER"
      );
      for (const customerImpact of customerNodes) {
        const customer = await prisma.customer.findUnique({
          where: { id: customerImpact.node.entityId },
          include: {
            customerProducts: {
              where: { isActive: true },
              include: { product: true },
            },
          },
        });

        if (!customer) continue;

        for (const cp of customer.customerProducts) {
          const specRequirements = cp.specRequirements as Record<string, unknown> | null;
          const contractExpiry = specRequirements?.['contractExpiry'] as string | undefined;
          if (contractExpiry) {
            events.push({
              date: contractExpiry,
              type: "contract_expiry",
              description: `Contract with ${customer.name} for ${cp.product.name} expires`,
              jurisdiction: "commercial",
              severity: "MEDIUM",
              affectedNodeIds: [customerImpact.nodeId],
            });
          }
        }
      }

      // Check for conflicting regulations across jurisdictions
      const conflicts = await detectTimelineConflicts(triggerId, tenantId, events, rule.jurisdiction);

      // Compute critical path (nodes on the most time-sensitive chain)
      const criticalPath = computeCriticalPath(events, affectedNodeIds);

      // Sort events by date
      events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Update trigger with conflict information
      if (conflicts.length > 0) {
        await prisma.cascadeTrigger.update({
          where: { id: triggerId },
          data: {
            conflictDates: {
              conflicts: conflicts.map((c) => ({
                id: c.id,
                description: c.description,
                jurisdictions: c.conflictingEvents.map((e) => e.jurisdiction),
              })),
              conflictingJurisdictions: conflicts.flatMap((c) =>
                c.conflictingEvents.map((e) => e.jurisdiction)
              ),
            },
          },
        });
      }

      const timeline: ComplianceTimeline = {
        triggerId,
        events,
        conflicts,
        criticalPath,
      };

      logger.info(
        {
          triggerId,
          eventCount: events.length,
          conflictCount: conflicts.length,
          criticalPathLength: criticalPath.length,
        },
        "Compliance timeline built"
      );

      return timeline;
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown timeline build error";
    logger.error({ triggerId, error: msg }, "Timeline build failed");
    throw error;
  }
}

/**
 * Detect conflicts between timeline events across jurisdictions.
 *
 * A conflict occurs when:
 * 1. Two regulations affect the same products with overlapping compliance windows
 * 2. Compliance actions in one jurisdiction conflict with requirements in another
 * 3. The same ingredient has different treatment in different jurisdictions
 *    (e.g., banned in one state, disclosure required in another)
 */
async function detectTimelineConflicts(
  triggerId: string,
  tenantId: string,
  events: TimelineEvent[],
  primaryJurisdiction: string
): Promise<TimelineConflict[]> {
  const conflicts: TimelineConflict[] = [];

  // Find all active rules affecting the same tenant's ingredients
  const matchedSubstances = await prisma.ruleSubstance.findMany({
    where: {
      isMatched: true,
      ingredient: { tenantId },
    },
    include: {
      rule: {
        include: { source: true },
      },
    },
  });

  // Group rules by jurisdiction
  const rulesByJurisdiction = new Map<string, Array<{
    ruleId: string;
    jurisdiction: string;
    ruleType: string;
    complianceDate: Date | null;
    effectiveDate: Date | null;
    sourceName: string;
  }>>();

  for (const rs of matchedSubstances) {
    const rule = rs.rule;
    const jurisdiction = rule.jurisdiction;

    if (!rulesByJurisdiction.has(jurisdiction)) {
      rulesByJurisdiction.set(jurisdiction, []);
    }
    rulesByJurisdiction.get(jurisdiction)!.push({
      ruleId: rule.id,
      jurisdiction,
      ruleType: rule.ruleType,
      complianceDate: rule.complianceDate,
      effectiveDate: rule.effectiveDate,
      sourceName: rule.source.name,
    });
  }

  // Check for conflicts between jurisdictions
  const jurisdictions = Array.from(rulesByJurisdiction.keys());

  for (let i = 0; i < jurisdictions.length; i++) {
    for (let j = i + 1; j < jurisdictions.length; j++) {
      const jurisdA = jurisdictions[i] ?? '';
      const jurisdB = jurisdictions[j] ?? '';
      const rulesA = rulesByJurisdiction.get(jurisdA) ?? [];
      const rulesB = rulesByJurisdiction.get(jurisdB) ?? [];

      // Check each pair of rules across the two jurisdictions
      for (const ruleA of rulesA) {
        for (const ruleB of rulesB) {
          // Conflict: different rule types for the same ingredient category
          if (ruleA.ruleType !== ruleB.ruleType && ruleA.complianceDate && ruleB.complianceDate) {
            const dayDiff = Math.abs(daysBetween(ruleA.complianceDate, ruleB.complianceDate));

            if (dayDiff <= CONFLICT_OVERLAP_DAYS) {
              const conflictId = `conflict_${ruleA.ruleId}_${ruleB.ruleId}`;

              conflicts.push({
                id: conflictId,
                description: `Conflicting compliance requirements: ${ruleA.sourceName} (${ruleA.ruleType}) in ${jurisdA} vs ${ruleB.sourceName} (${ruleB.ruleType}) in ${jurisdB}. Deadlines are ${dayDiff} days apart.`,
                conflictingEvents: [
                  {
                    eventId: `${ruleA.ruleId}_compliance`,
                    date: ruleA.complianceDate.toISOString(),
                    jurisdiction: jurisdA,
                  },
                  {
                    eventId: `${ruleB.ruleId}_compliance`,
                    date: ruleB.complianceDate.toISOString(),
                    jurisdiction: jurisdB,
                  },
                ],
                resolutionOptions: generateResolutionOptions(ruleA, ruleB),
              });
            }
          }

          // Conflict: same rule type but different thresholds
          if (ruleA.ruleType === ruleB.ruleType && ruleA.complianceDate && ruleB.complianceDate) {
            const dayDiff = Math.abs(daysBetween(ruleA.complianceDate, ruleB.complianceDate));

            if (dayDiff <= 30) {
              const conflictId = `threshold_conflict_${ruleA.ruleId}_${ruleB.ruleId}`;

              conflicts.push({
                id: conflictId,
                description: `Overlapping compliance deadlines: ${ruleA.sourceName} and ${ruleB.sourceName} both require ${ruleA.ruleType} within ${dayDiff} days. Coordinate compliance efforts.`,
                conflictingEvents: [
                  {
                    eventId: `${ruleA.ruleId}_compliance`,
                    date: ruleA.complianceDate.toISOString(),
                    jurisdiction: jurisdA,
                  },
                  {
                    eventId: `${ruleB.ruleId}_compliance`,
                    date: ruleB.complianceDate.toISOString(),
                    jurisdiction: jurisdB,
                  },
                ],
                resolutionOptions: [
                  {
                    description: `Adopt the stricter requirement to satisfy both jurisdictions simultaneously`,
                    costImpact: 0.1, // 10% premium for stricter compliance
                    timelineImpactDays: 0,
                  },
                  {
                    description: `Comply with each jurisdiction separately (parallel compliance tracks)`,
                    costImpact: 0.3, // 30% more expensive due to dual tracks
                    timelineImpactDays: dayDiff,
                  },
                ],
              });
            }
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Generate resolution options for a conflict between two rules.
 */
function generateResolutionOptions(
  ruleA: { ruleType: string; sourceName: string; complianceDate: Date | null; jurisdiction: string },
  ruleB: { ruleType: string; sourceName: string; complianceDate: Date | null; jurisdiction: string }
): Array<{ description: string; costImpact: number; timelineImpactDays: number }> {
  const options: Array<{ description: string; costImpact: number; timelineImpactDays: number }> = [];

  // Option 1: Comply with the stricter rule (usually reformulation satisfies labeling)
  const stricterRule = getStricterRule(ruleA.ruleType, ruleB.ruleType);
  options.push({
    description: `Comply with the stricter rule (${stricterRule}) to satisfy both ${ruleA.jurisdiction} and ${ruleB.jurisdiction} simultaneously`,
    costImpact: 0.15, // 15% cost premium for adopting the stricter standard
    timelineImpactDays: 0,
  });

  // Option 2: Reformulate for the ban, which automatically satisfies the labeling requirement
  if (ruleA.ruleType === "BAN" || ruleB.ruleType === "BAN") {
    options.push({
      description: `Reformulate to remove the ingredient entirely (satisfies both ban and labeling requirements)`,
      costImpact: 0.2,
      timelineImpactDays: -30, // 30 days earlier than dual compliance
    });
  }

  // Option 3: Dual compliance (different product versions for different markets)
  options.push({
    description: `Maintain separate product formulations for ${ruleA.jurisdiction} and ${ruleB.jurisdiction} markets`,
    costImpact: 0.4, // 40% more expensive (dual production, labeling, inventory)
    timelineImpactDays: 60, // Extra time for parallel compliance
  });

  // Option 4: Exit the more restrictive market
  options.push({
    description: `Exit the ${ruleA.ruleType === "BAN" ? ruleA.jurisdiction : ruleB.jurisdiction} market if compliance cost exceeds revenue`,
    costImpact: -0.3, // Cost savings but revenue loss
    timelineImpactDays: -60, // No compliance needed
  });

  return options;
}

/**
 * Determine which rule type is stricter.
 */
function getStricterRule(typeA: string, typeB: string): string {
  const strictness: Record<string, number> = {
    BAN: 10,
    MARKET_WITHDRAWAL: 9,
    PHASE_OUT: 8,
    CONCENTRATION_LIMIT: 7,
    WARNING_LABEL: 6,
    DISCLOSURE: 5,
    CERTIFICATION: 4,
    REPORTING: 3,
    INGREDIENT_REVIEW: 2,
  };
  return (strictness[typeA] ?? 1) >= (strictness[typeB] ?? 1) ? typeA : typeB;
}

/**
 * Compute the critical path through the timeline.
 * The critical path includes all events where missing the deadline
 * would result in the most severe consequences.
 */
function computeCriticalPath(
  events: TimelineEvent[],
  affectedNodeIds: string[]
): string[] {
  // Critical path: all events with CRITICAL or HIGH severity
  // that affect the most nodes
  const criticalEvents = events.filter(
    (e) => e.severity === "CRITICAL" || e.severity === "HIGH"
  );

  // Sort by urgency (closest deadline first)
  criticalEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Return node IDs that are on the critical path
  const criticalNodeIds = new Set<string>();
  for (const event of criticalEvents) {
    for (const nodeId of event.affectedNodeIds) {
      criticalNodeIds.add(nodeId);
    }
  }

  return Array.from(criticalNodeIds);
}

/**
 * Map a rule type to a severity level for timeline events.
 */
function mapRuleTypeToSeverity(ruleType: string): Severity {
  const severityMap: Record<string, Severity> = {
    BAN: "CRITICAL",
    MARKET_WITHDRAWAL: "CRITICAL",
    PHASE_OUT: "HIGH",
    CONCENTRATION_LIMIT: "HIGH",
    WARNING_LABEL: "MEDIUM",
    DISCLOSURE: "MEDIUM",
    CERTIFICATION: "MEDIUM",
    REPORTING: "LOW",
    INGREDIENT_REVIEW: "LOW",
  };
  return severityMap[ruleType] ?? "MEDIUM";
}

/**
 * Check for deadline urgency across all active triggers for a tenant.
 * Returns the most urgent deadlines that need attention.
 */
export async function getUrgentDeadlines(
  tenantId: string,
  withinDays: number = 90
): Promise<Array<{
  triggerId: string;
  title: string;
  deadlineDate: Date;
  daysRemaining: number;
  severity: Severity;
  triggerType: TriggerType;
  totalSkusAffected: number;
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
        deadlineDate: { not: null },
        status: { notIn: ["COMPLETED", "DISMISSED"] },
      },
      orderBy: { deadlineDate: "asc" },
    });

    const now = new Date();
    const urgentTriggers: Array<{
      triggerId: string;
      title: string;
      deadlineDate: Date;
      daysRemaining: number;
      severity: Severity;
      triggerType: TriggerType;
      totalSkusAffected: number;
    }> = [];

    for (const trigger of triggers) {
      if (!trigger.deadlineDate) continue;
      const days = daysUntilDeadline(trigger.deadlineDate);
      if (days !== null && days >= 0 && days <= withinDays) {
        urgentTriggers.push({
          triggerId: trigger.id,
          title: trigger.title,
          deadlineDate: trigger.deadlineDate,
          daysRemaining: days,
          severity: trigger.severity,
          triggerType: trigger.triggerType,
          totalSkusAffected: trigger.totalSkusAffected,
        });
      }
    }

    return urgentTriggers;
  });
}
