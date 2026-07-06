// GET /api/dashboard/recent-triggers — Recently detected cascade triggers
// Returns the last N triggers with full details including impacts and rule data.
// Supports severity filter, sorted by creation date descending.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/errors";
import { createTenantLogger } from "@/lib/logger";
import type { Severity, ImpactType, TriggerType, TriggerStatus } from "@prisma/client";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Query param schema
// ---------------------------------------------------------------------------

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]).optional(),
});

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface ImpactSummary {
  impactType: ImpactType;
  description: string;
  financialImpact: number | null;
  reformRequired: boolean;
  reformCost: number | null;
  priority: number | null;
}

interface RecentTriggerEntry {
  triggerId: string;
  title: string;
  severity: Severity;
  triggerType: TriggerType;
  status: TriggerStatus;
  affectedNodeCount: number;
  totalSkusAffected: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  deadlineDate: string | null;
  daysUntilDeadline: number | null;
  cascadeDepth: number;
  cascadeBreadth: number;
  ruleId: string;
  ruleDescription: string;
  jurisdiction: string;
  ruleType: string;
  sourceName: string;
  sourceType: string;
  impacts: ImpactSummary[];
  createdAt: string;
}

interface RecentTriggersResponse {
  triggers: RecentTriggerEntry[];
  total: number;
  limit: number;
  severityFilter: Severity | null;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Session required to access recent triggers");
  }

  const userObj = session.user as Record<string, unknown>;
  const tenantId = userObj["tenantId"] as string | undefined;

  if (!tenantId) {
    throw new AuthorizationError("Tenant context required for recent triggers");
  }

  const log = createTenantLogger(tenantId, userObj["id"] as string | undefined);

  // Parse & validate query parameters
  const { searchParams } = new URL(request.url);
  const parseResult = querySchema.safeParse({
    limit: searchParams.get("limit") ?? undefined,
    severity: searchParams.get("severity") ?? undefined,
  });

  if (!parseResult.success) {
    throw new ValidationError(
      parseResult.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  const { limit, severity } = parseResult.data;

  log.info(
    { component: "dashboard", operation: "recent-triggers", limit, severity },
    "Fetching recent triggers"
  );

  try {
    // -----------------------------------------------------------------------
    // 1. Build where clause
    // -----------------------------------------------------------------------
    const whereClause: Record<string, unknown> = {
      graph: { tenantId },
    };

    if (severity) {
      whereClause["severity"] = severity;
    }

    // -----------------------------------------------------------------------
    // 2. Count total matching triggers
    // -----------------------------------------------------------------------
    const total = await prisma.cascadeTrigger.count({
      where: whereClause,
    });

    // -----------------------------------------------------------------------
    // 3. Fetch triggers with related data
    // -----------------------------------------------------------------------
    const triggers = await prisma.cascadeTrigger.findMany({
      where: whereClause,
      include: {
        rule: {
          include: {
            source: {
              select: {
                name: true,
                sourceType: true,
              },
            },
          },
        },
        impacts: {
          select: {
            impactType: true,
            description: true,
            financialImpact: true,
            reformRequired: true,
            reformCost: true,
            priority: true,
          },
          orderBy: { priority: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // -----------------------------------------------------------------------
    // 4. Transform to response shape
    // -----------------------------------------------------------------------
    const now = new Date();

    const triggerEntries: RecentTriggerEntry[] = triggers.map((trigger) => {
      const deadlineDate = trigger.deadlineDate;
      const daysUntilDeadline = deadlineDate
        ? Math.max(
            0,
            Math.ceil(
              (deadlineDate.getTime() - now.getTime()) / 86_400_000
            )
          )
        : null;

      const impacts: ImpactSummary[] = trigger.impacts.map((impact) => ({
        impactType: impact.impactType,
        description: impact.description,
        financialImpact: impact.financialImpact
          ? Number(impact.financialImpact)
          : null,
        reformRequired: impact.reformRequired,
        reformCost: impact.reformCost ? Number(impact.reformCost) : null,
        priority: impact.priority,
      }));

      return {
        triggerId: trigger.id,
        title: trigger.title,
        severity: trigger.severity,
        triggerType: trigger.triggerType,
        status: trigger.status,
        affectedNodeCount: trigger.affectedNodeIds.length,
        totalSkusAffected: trigger.totalSkusAffected,
        estimatedCostMin: trigger.estimatedCostMin
          ? Number(trigger.estimatedCostMin)
          : null,
        estimatedCostMax: trigger.estimatedCostMax
          ? Number(trigger.estimatedCostMax)
          : null,
        deadlineDate: deadlineDate?.toISOString() ?? null,
        daysUntilDeadline,
        cascadeDepth: trigger.cascadeDepth,
        cascadeBreadth: trigger.cascadeBreadth,
        ruleId: trigger.ruleId,
        ruleDescription: trigger.rule.description,
        jurisdiction: trigger.rule.jurisdiction,
        ruleType: trigger.rule.ruleType,
        sourceName: trigger.rule.source.name,
        sourceType: trigger.rule.source.sourceType,
        impacts,
        createdAt: trigger.createdAt.toISOString(),
      };
    });

    const response: RecentTriggersResponse = {
      triggers: triggerEntries,
      total,
      limit,
      severityFilter: severity ?? null,
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
      { err: error, component: "dashboard", operation: "recent-triggers" },
      "Failed to fetch recent triggers"
    );
    throw error;
  }
}
