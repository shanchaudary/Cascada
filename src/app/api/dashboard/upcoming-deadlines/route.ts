// GET /api/dashboard/upcoming-deadlines — Upcoming compliance deadlines
// Rules with compliance dates in the future, grouped by urgency buckets.
// Each deadline includes rule description, jurisdiction, penalty info, affected SKUs.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/errors";
import { createTenantLogger } from "@/lib/logger";
import type { Severity, TriggerStatus } from "@prisma/client";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Query param schema
// ---------------------------------------------------------------------------

const querySchema = z.object({
  daysAhead: z.coerce.number().int().positive().max(365).default(90),
});

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface DeadlineEntry {
  ruleId: string;
  ruleDescription: string;
  jurisdiction: string;
  ruleType: string;
  complianceDate: string;
  daysRemaining: number;
  urgencyBucket: string;
  penaltyType: string | null;
  penaltyAmount: number | null;
  sourceName: string;
  sourceType: string;
  severity: Severity | null;
  affectedSkusCount: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
}

interface UrgencyBucketSummary {
  bucket: string;
  count: number;
  totalSkusAffected: number;
  totalEstimatedCostMax: number;
}

interface UpcomingDeadlinesResponse {
  deadlines: DeadlineEntry[];
  urgencyBuckets: UrgencyBucketSummary[];
  totalDeadlines: number;
  daysAhead: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Active trigger statuses
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: TriggerStatus[] = [
  "DETECTED",
  "ANALYZING",
  "IMPACT_ASSESSED",
  "DECISION_PACKAGE_READY",
  "DECISION_MADE",
  "WORKFLOW_STARTED",
];

// ---------------------------------------------------------------------------
// Urgency bucket classification
// ---------------------------------------------------------------------------

function classifyUrgency(daysRemaining: number): string {
  if (daysRemaining <= 30) return "0-30 days";
  if (daysRemaining <= 60) return "31-60 days";
  if (daysRemaining <= 90) return "61-90 days";
  return "90+ days";
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Session required to access deadline data");
  }

  const userObj = session.user as Record<string, unknown>;
  const tenantId = userObj["tenantId"] as string | undefined;

  if (!tenantId) {
    throw new AuthorizationError("Tenant context required for deadline data");
  }

  const log = createTenantLogger(tenantId, userObj["id"] as string | undefined);

  // Parse & validate query parameters
  const { searchParams } = new URL(request.url);
  const parseResult = querySchema.safeParse({
    daysAhead: searchParams.get("daysAhead") ?? undefined,
  });

  if (!parseResult.success) {
    throw new ValidationError(
      parseResult.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  const { daysAhead } = parseResult.data;
  const now = new Date();
  const futureDate = new Date(now.getTime() + daysAhead * 86_400_000);

  log.info(
    { component: "dashboard", operation: "upcoming-deadlines", daysAhead },
    "Fetching upcoming deadlines"
  );

  try {
    // -----------------------------------------------------------------------
    // 1. Fetch active triggers with compliance deadlines in the window
    // -----------------------------------------------------------------------
    const triggers = await prisma.cascadeTrigger.findMany({
      where: {
        graph: { tenantId },
        status: { in: ACTIVE_STATUSES },
        deadlineDate: { gte: now, lte: futureDate },
      },
      include: {
        rule: {
          include: {
            source: true,
            substances: {
              where: { isMatched: true },
              select: { id: true },
            },
          },
        },
      },
      orderBy: { deadlineDate: "asc" },
    });

    // Also check for rules with complianceDate that may not have triggers yet
    // but are relevant to the tenant via their cascade graph's regulation nodes
    const graphIds = await prisma.cascadeGraph.findMany({
      where: { tenantId },
      select: { id: true },
    });
    const tenantGraphIds = graphIds.map((g) => g.id);

    const regulationNodes = await prisma.cascadeNode.findMany({
      where: {
        graphId: { in: tenantGraphIds },
        nodeType: "REGULATION",
      },
      select: { entityId: true },
    });

    const tenantRuleIds = new Set([
      ...triggers.map((t) => t.ruleId),
      ...regulationNodes.map((n) => n.entityId),
    ]);

    // Fetch rules with compliance dates in the window that are relevant
    const upcomingRules = await prisma.rule.findMany({
      where: {
        id: { in: [...tenantRuleIds] },
        complianceDate: { gte: now, lte: futureDate },
      },
      include: {
        source: true,
        substances: {
          where: { isMatched: true },
          select: { id: true },
        },
        cascadeTriggers: {
          where: {
            graph: { tenantId },
            status: { in: ACTIVE_STATUSES },
          },
          select: {
            severity: true,
            totalSkusAffected: true,
            estimatedCostMin: true,
            estimatedCostMax: true,
          },
        },
      },
      orderBy: { complianceDate: "asc" },
    });

    // -----------------------------------------------------------------------
    // 2. Build deadline entries
    // -----------------------------------------------------------------------
    const deadlines: DeadlineEntry[] = upcomingRules.map((rule) => {
      const complianceDate = rule.complianceDate ?? new Date();
      const daysRemaining = Math.max(
        0,
        Math.ceil(
          (complianceDate.getTime() - now.getTime()) / 86_400_000
        )
      );
      const urgencyBucket = classifyUrgency(daysRemaining);

      // Find matching trigger for severity and SKU data
      const matchingTrigger = triggers.find((t) => t.ruleId === rule.id);
      const triggerData = rule.cascadeTriggers[0] ?? matchingTrigger;

      const affectedSkusCount = triggerData?.totalSkusAffected ?? 0;
      const severity = triggerData?.severity ?? null;
      const estimatedCostMin = triggerData?.estimatedCostMin
        ? Number(triggerData.estimatedCostMin)
        : null;
      const estimatedCostMax = triggerData?.estimatedCostMax
        ? Number(triggerData.estimatedCostMax)
        : null;

      return {
        ruleId: rule.id,
        ruleDescription: rule.description,
        jurisdiction: rule.jurisdiction,
        ruleType: rule.ruleType,
        complianceDate: complianceDate.toISOString(),
        daysRemaining,
        urgencyBucket,
        penaltyType: rule.penaltyType,
        penaltyAmount: rule.penaltyAmount ? Number(rule.penaltyAmount) : null,
        sourceName: rule.source.name,
        sourceType: rule.source.sourceType,
        severity,
        affectedSkusCount,
        estimatedCostMin,
        estimatedCostMax,
      };
    });

    // Sort by days remaining ascending (most urgent first)
    deadlines.sort((a, b) => a.daysRemaining - b.daysRemaining);

    // -----------------------------------------------------------------------
    // 3. Build urgency bucket summaries
    // -----------------------------------------------------------------------
    const bucketOrder = ["0-30 days", "31-60 days", "61-90 days", "90+ days"];
    const bucketMap = new Map<string, DeadlineEntry[]>();

    for (const deadline of deadlines) {
      const bucket = deadline.urgencyBucket;
      if (!bucketMap.has(bucket)) {
        bucketMap.set(bucket, []);
      }
      bucketMap.get(bucket)!.push(deadline);
    }

    const urgencyBuckets: UrgencyBucketSummary[] = bucketOrder.map((bucket) => {
      const entries = bucketMap.get(bucket) ?? [];
      return {
        bucket,
        count: entries.length,
        totalSkusAffected: entries.reduce((sum, e) => sum + e.affectedSkusCount, 0),
        totalEstimatedCostMax: entries.reduce(
          (sum, e) => sum + (e.estimatedCostMax ?? 0),
          0
        ),
      };
    });

    const response: UpcomingDeadlinesResponse = {
      deadlines,
      urgencyBuckets,
      totalDeadlines: deadlines.length,
      daysAhead,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    log.error(
      { err: error, component: "dashboard", operation: "upcoming-deadlines" },
      "Failed to fetch upcoming deadlines"
    );
    throw error;
  }
}
