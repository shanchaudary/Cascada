// Cascada — Decision Package Report API Route
// GET /api/decisions/[id]/report — Decision package report data for PDF generation

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

// GET /api/decisions/[id]/report — Decision package report data for PDF generation
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // Fetch the full decision package with all related data for report generation
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
                    },
                  },
                },
                orderBy: { priority: "asc" },
              },
              rule: {
                include: {
                  source: {
                    select: {
                      id: true,
                      name: true,
                      sourceType: true,
                      jurisdiction: true,
                      sourceUrl: true,
                      effectiveDate: true,
                    },
                  },
                  substances: {
                    where: { isMatched: true },
                    select: {
                      id: true,
                      substanceName: true,
                      casNumber: true,
                      eenumber: true,
                      threshold: true,
                      thresholdUnit: true,
                      matchConfidence: true,
                      ingredient: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
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
    });

    if (!decisionPackage) {
      throw new NotFoundError("DecisionPackage", id);
    }

    // Fetch tenant info for the report header
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, plan: true },
    });

    const trigger = decisionPackage.trigger;

    // Build structured report data
    // Section 1: Executive Summary
    const executiveSummary = {
      title: decisionPackage.title,
      summary: decisionPackage.summary,
      mandateSummary: decisionPackage.mandateSummary,
      recommendation: decisionPackage.recommendation,
      severity: trigger.severity,
      triggerType: trigger.triggerType,
      generatedAt: decisionPackage.generatedAt,
      deadlineDate: trigger.deadlineDate,
    };

    // Section 2: Regulatory Mandate Details
    const regulatoryMandate = {
      source: trigger.rule.source,
      rule: {
        jurisdiction: trigger.rule.jurisdiction,
        ruleType: trigger.rule.ruleType,
        description: trigger.rule.description,
        effectiveDate: trigger.rule.effectiveDate,
        complianceDate: trigger.rule.complianceDate,
        penaltyType: trigger.rule.penaltyType,
        penaltyAmount: trigger.rule.penaltyAmount,
      },
      affectedSubstances: trigger.rule.substances.map((sub) => ({
        substanceName: sub.substanceName,
        casNumber: sub.casNumber,
        eenumber: sub.eenumber,
        threshold: sub.threshold,
        thresholdUnit: sub.thresholdUnit,
        matchConfidence: sub.matchConfidence,
        matchedIngredient: sub.ingredient,
      })),
    };

    // Section 3: Affected SKUs
    const affectedSkus = decisionPackage.affectedSkuList as Record<string, unknown>[] | null ?? [];

    // Section 4: Cascade Impact Analysis
    const impactAnalysis = trigger.impacts.map((impact) => ({
      id: impact.id,
      impactType: impact.impactType,
      description: impact.description,
      financialImpact: impact.financialImpact,
      timelineImpact: impact.timelineImpact,
      reformRequired: impact.reformRequired,
      reformCost: impact.reformCost,
      reformOptions: impact.reformOptions,
      priority: impact.priority,
      affectedEntity: {
        nodeType: impact.node.nodeType,
        label: impact.node.label,
        riskScore: impact.node.riskScore,
      },
    }));

    // Section 5: Compliance Timeline
    const complianceTimeline = decisionPackage.complianceTimeline as Record<string, unknown>[] | null ?? [];

    // Section 6: Reformulation Options
    const reformulationOptions = decisionPackage.reformulationOptions as Record<string, unknown>[] | null ?? [];

    // Section 7: Prioritization Matrix
    const prioritization = decisionPackage.prioritization as Record<string, unknown> | null;

    // Section 8: Decision Record (if any)
    const decisionRecord = decisionPackage.decision
      ? {
          decision: decisionPackage.decision,
          decidedBy: decisionPackage.decidedBy,
          decidedAt: decisionPackage.decidedAt,
          decisionNotes: decisionPackage.decisionNotes,
        }
      : null;

    // Compute aggregate financials
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

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.info(
      {
        userId,
        role,
        decisionPackageId: id,
        triggerId: trigger.id,
        impactCount: trigger.impacts.length,
        hasDecision: decisionPackage.decision !== null,
        durationMs: Date.now() - requestStart,
        action: "decision_report",
      },
      "Retrieved decision package report data"
    );

    return NextResponse.json({
      report: {
        meta: {
          decisionPackageId: id,
          tenant: tenant
            ? { name: tenant.name, slug: tenant.slug }
            : null,
          generatedAt: new Date().toISOString(),
          reportType: "decision_package",
        },
        sections: {
          executiveSummary,
          regulatoryMandate,
          affectedSkus,
          impactAnalysis,
          complianceTimeline,
          reformulationOptions,
          prioritization,
          decisionRecord,
        },
        aggregates: {
          totalFinancialImpact,
          totalReformCost,
          reformRequiredCount,
          impactCount: trigger.impacts.length,
          affectedSkuCount: affectedSkus.length,
          matchedSubstanceCount: trigger.rule.substances.length,
          cascadeDepth: trigger.cascadeDepth,
          cascadeBreadth: trigger.cascadeBreadth,
          totalSkusAffected: trigger.totalSkusAffected,
          estimatedCostRange: {
            min: trigger.estimatedCostMin,
            max: trigger.estimatedCostMax,
          },
        },
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "decision_report_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "decision_report_error" }, "Unexpected error retrieving decision report");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve decision package report" } },
      { status: 500 }
    );
  }
}
