// Cascada — Decision Package Detail API Route
// GET /api/decisions/[id] — Full decision package with trigger, impacts, timeline

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import {
  AuthenticationError,
  NotFoundError,
  CascadaError,
  toError,
} from "@/lib/errors";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Extract and validate the current session + tenant context.
 */
async function getAuthenticatedContext() {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Authentication required");
  }

  const sessionUser = session.user as Record<string, unknown>;
  const userId = sessionUser["id"] as string | undefined;
  const tenantId = sessionUser["tenantId"] as string | undefined;
  const role = sessionUser["role"] as string | undefined;

  if (!userId || !tenantId || !role) {
    throw new AuthenticationError("Session is missing required claims");
  }

  return { userId, tenantId, role };
}

// GET /api/decisions/[id] — Full decision package with trigger, impacts, timeline
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const decisionPackage = await withTenant(tenantId, async () => {
      return prisma.decisionPackage.findFirst({
        where: { id, tenantId },
        include: {
          trigger: {
            include: {
              impacts: {
                include: {
                  node: {
                    select: {
                      id: true,
                      nodeType: true,
                      label: true,
                      entityId: true,
                      riskScore: true,
                      properties: true,
                    },
                  },
                },
                orderBy: { priority: "asc" },
              },
              rule: {
                select: {
                  id: true,
                  jurisdiction: true,
                  ruleType: true,
                  description: true,
                  effectiveDate: true,
                  complianceDate: true,
                  penaltyType: true,
                  penaltyAmount: true,
                  source: {
                    select: {
                      id: true,
                      name: true,
                      sourceType: true,
                      status: true,
                      sourceUrl: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
    });

    if (!decisionPackage) {
      throw new NotFoundError("DecisionPackage", id);
    }

    const trigger = decisionPackage.trigger;

    // Organize impacts by type for easier consumption
    const impactsByType: Record<string, typeof trigger.impacts> = {};
    for (const impact of trigger.impacts) {
      const impactType = impact.impactType as string;
      if (!impactsByType[impactType]) {
        impactsByType[impactType] = [];
      }
      impactsByType[impactType].push(impact);
    }

    // Compute total financial exposure from impacts
    let totalFinancialImpact = 0;
    let totalReformCost = 0;
    let reformRequiredCount = 0;

    for (const impact of trigger.impacts) {
      if (impact.financialImpact) {
        totalFinancialImpact += Number(impact.financialImpact);
      }
      if (impact.reformRequired) {
        reformRequiredCount += 1;
      }
      if (impact.reformCost) {
        totalReformCost += Number(impact.reformCost);
      }
    }

    // Compute timeline summary from compliance timeline JSON
    const complianceTimeline = decisionPackage.complianceTimeline as Record<string, unknown>[] | null;
    const timelineEvents = complianceTimeline ?? [];

    // Extract unique affected node types
    const affectedNodeTypes = new Set<string>();
    for (const impact of trigger.impacts) {
      affectedNodeTypes.add(impact.node.nodeType);
    }

    // Build the decision info if a decision has been made
    const decisionInfo = decisionPackage.decision
      ? {
          decision: decisionPackage.decision,
          decidedBy: decisionPackage.decidedBy,
          decidedAt: decisionPackage.decidedAt,
          decisionNotes: decisionPackage.decisionNotes,
        }
      : null;

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        decisionPackageId: id,
        triggerId: trigger.id,
        impactCount: trigger.impacts.length,
        hasDecision: decisionPackage.decision !== null,
        durationMs: Date.now() - requestStart,
        action: "decision_detail",
      },
      "Retrieved decision package detail"
    );

    return NextResponse.json({
      decisionPackage: {
        id: decisionPackage.id,
        title: decisionPackage.title,
        summary: decisionPackage.summary,
        mandateSummary: decisionPackage.mandateSummary,
        affectedSkuList: decisionPackage.affectedSkuList,
        complianceTimeline: decisionPackage.complianceTimeline,
        reformulationOptions: decisionPackage.reformulationOptions,
        prioritization: decisionPackage.prioritization,
        recommendation: decisionPackage.recommendation,
        generatedAt: decisionPackage.generatedAt,
        deliveredAt: decisionPackage.deliveredAt,
        deliveryMethod: decisionPackage.deliveryMethod,
        decisionInfo,
        trigger: {
          id: trigger.id,
          triggerType: trigger.triggerType,
          severity: trigger.severity,
          status: trigger.status,
          title: trigger.title,
          description: trigger.description,
          cascadeDepth: trigger.cascadeDepth,
          cascadeBreadth: trigger.cascadeBreadth,
          totalSkusAffected: trigger.totalSkusAffected,
          estimatedCostMin: trigger.estimatedCostMin,
          estimatedCostMax: trigger.estimatedCostMax,
          deadlineDate: trigger.deadlineDate,
          conflictDates: trigger.conflictDates,
          rule: trigger.rule,
          impacts: trigger.impacts.map((impact) => ({
            id: impact.id,
            impactType: impact.impactType,
            description: impact.description,
            financialImpact: impact.financialImpact,
            timelineImpact: impact.timelineImpact,
            reformRequired: impact.reformRequired,
            reformCost: impact.reformCost,
            reformOptions: impact.reformOptions,
            priority: impact.priority,
            node: impact.node,
          })),
        },
      },
      analysis: {
        impactsByType,
        totalFinancialImpact,
        totalReformCost,
        reformRequiredCount,
        affectedNodeTypes: Array.from(affectedNodeTypes),
        timelineEventCount: timelineEvents.length,
        impactCount: trigger.impacts.length,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "decision_detail_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "decision_detail_error" }, "Unexpected error retrieving decision package");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve decision package" } },
      { status: 500 }
    );
  }
}
