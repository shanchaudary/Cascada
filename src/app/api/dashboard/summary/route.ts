// GET /api/dashboard/summary — Executive dashboard summary
// Aggregates key metrics across triggers, decisions, workflows, and activity.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { createTenantLogger } from "@/lib/logger";
import type { Severity, TriggerStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface TriggersBySeverity {
  severity: Severity;
  count: number;
}

interface ComplianceDeadlineBucket {
  window: string;
  count: number;
}

interface DashboardSummaryResponse {
  totalActiveTriggers: number;
  triggersBySeverity: TriggersBySeverity[];
  totalSkusAffected: number;
  estimatedCostRange: { min: number; max: number };
  complianceDeadlines: ComplianceDeadlineBucket[];
  pendingDecisionPackages: number;
  activeWorkflows: number;
  recentActivityCount: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Severity ordering helper
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Session required to access dashboard summary");
  }

  const userObj = session.user as Record<string, unknown>;
  const tenantId = userObj["tenantId"] as string | undefined;

  if (!tenantId) {
    throw new AuthorizationError("Tenant context required for dashboard access");
  }

  const log = createTenantLogger(tenantId, userObj["id"] as string | undefined);
  log.info({ component: "dashboard", operation: "summary" }, "Fetching dashboard summary");

  try {
    // Active statuses — everything that has not been resolved
    const activeStatuses: TriggerStatus[] = [
      "DETECTED",
      "ANALYZING",
      "IMPACT_ASSESSED",
      "DECISION_PACKAGE_READY",
      "DECISION_MADE",
      "WORKFLOW_STARTED",
    ];

    // -----------------------------------------------------------------------
    // 1. Active triggers by severity
    // -----------------------------------------------------------------------
    const triggerGroups = await prisma.cascadeTrigger.groupBy({
      by: ["severity"],
      where: {
        graph: { tenantId },
        status: { in: activeStatuses },
      },
      _count: true,
    });

    const triggersBySeverity: TriggersBySeverity[] = SEVERITY_ORDER.map(
      (severity) => {
        const group = triggerGroups.find((g) => g.severity === severity);
        return { severity, count: group?._count ?? 0 };
      }
    );

    const totalActiveTriggers = triggersBySeverity.reduce(
      (sum, item) => sum + item.count,
      0
    );

    // -----------------------------------------------------------------------
    // 2. Total SKUs affected + estimated cost range
    // -----------------------------------------------------------------------
    const costAggregate = await prisma.cascadeTrigger.aggregate({
      where: {
        graph: { tenantId },
        status: { in: activeStatuses },
      },
      _sum: {
        totalSkusAffected: true,
        estimatedCostMin: true,
        estimatedCostMax: true,
      },
    });

    const totalSkusAffected = costAggregate._sum?.totalSkusAffected ?? 0;
    const estimatedCostMin = Number(costAggregate._sum?.estimatedCostMin ?? 0);
    const estimatedCostMax = Number(costAggregate._sum?.estimatedCostMax ?? 0);

    // -----------------------------------------------------------------------
    // 3. Compliance deadlines — next 30 / 60 / 90 days
    // -----------------------------------------------------------------------
    const now = new Date();
    const day30 = new Date(now.getTime() + 30 * 86_400_000);
    const day60 = new Date(now.getTime() + 60 * 86_400_000);
    const day90 = new Date(now.getTime() + 90 * 86_400_000);

    const [count30, count60, count90] = await Promise.all([
      prisma.cascadeTrigger.count({
        where: {
          graph: { tenantId },
          deadlineDate: { gte: now, lte: day30 },
          status: { in: activeStatuses },
        },
      }),
      prisma.cascadeTrigger.count({
        where: {
          graph: { tenantId },
          deadlineDate: { gte: now, lte: day60 },
          status: { in: activeStatuses },
        },
      }),
      prisma.cascadeTrigger.count({
        where: {
          graph: { tenantId },
          deadlineDate: { gte: now, lte: day90 },
          status: { in: activeStatuses },
        },
      }),
    ]);

    const complianceDeadlines: ComplianceDeadlineBucket[] = [
      { window: "0-30 days", count: count30 },
      { window: "31-60 days", count: count60 - count30 },
      { window: "61-90 days", count: count90 - count60 },
    ];

    // -----------------------------------------------------------------------
    // 4. Pending decision packages
    // -----------------------------------------------------------------------
    const pendingDecisionPackages = await prisma.decisionPackage.count({
      where: {
        tenantId,
        decision: null,
      },
    });

    // -----------------------------------------------------------------------
    // 5. Active workflows
    // -----------------------------------------------------------------------
    const activeWorkflows = await prisma.workflowInstance.count({
      where: {
        tenantId,
        status: { in: ["PENDING", "RUNNING", "AWAITING_APPROVAL"] },
      },
    });

    // -----------------------------------------------------------------------
    // 6. Recent activity count (last 7 days)
    // -----------------------------------------------------------------------
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

    const recentTriggerCount = await prisma.cascadeTrigger.count({
      where: {
        graph: { tenantId },
        createdAt: { gte: sevenDaysAgo },
      },
    });

    const recentDecisionCount = await prisma.decisionPackage.count({
      where: {
        tenantId,
        decidedAt: { gte: sevenDaysAgo },
      },
    });

    const recentWorkflowCount = await prisma.workflowInstance.count({
      where: {
        tenantId,
        startedAt: { gte: sevenDaysAgo },
      },
    });

    const recentActivityCount =
      recentTriggerCount + recentDecisionCount + recentWorkflowCount;

    // -----------------------------------------------------------------------
    // Assemble response
    // -----------------------------------------------------------------------
    const response: DashboardSummaryResponse = {
      totalActiveTriggers,
      triggersBySeverity,
      totalSkusAffected,
      estimatedCostRange: { min: estimatedCostMin, max: estimatedCostMax },
      complianceDeadlines,
      pendingDecisionPackages,
      activeWorkflows,
      recentActivityCount,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof AuthorizationError) {
      throw error;
    }
    log.error(
      { err: error, component: "dashboard", operation: "summary" },
      "Failed to generate dashboard summary"
    );
    throw error;
  }
}
