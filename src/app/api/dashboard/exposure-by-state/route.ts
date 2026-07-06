// GET /api/dashboard/exposure-by-state — Regulatory exposure broken down by state/jurisdiction
// For each jurisdiction: active rules, triggers, SKUs affected, financial exposure, most severe trigger.

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
  minSeverity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]).optional(),
});

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface StateExposure {
  jurisdiction: string;
  activeRuleCount: number;
  activeTriggerCount: number;
  skusAffected: number;
  financialExposure: number;
  mostSevereTrigger: Severity | null;
  triggerBreakdown: Array<{ severity: Severity; count: number }>;
}

interface ExposureByStateResponse {
  exposures: StateExposure[];
  totalJurisdictions: number;
  totalFinancialExposure: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Severity rank helper (higher = more severe)
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

const SEVERITY_THRESHOLD: Record<string, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

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
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Session required to access exposure data");
  }

  const userObj = session.user as Record<string, unknown>;
  const tenantId = userObj["tenantId"] as string | undefined;

  if (!tenantId) {
    throw new AuthorizationError("Tenant context required for exposure data");
  }

  const log = createTenantLogger(tenantId, userObj["id"] as string | undefined);

  // Parse & validate query params
  const { searchParams } = new URL(request.url);
  const parseResult = querySchema.safeParse({
    minSeverity: searchParams.get("minSeverity") ?? undefined,
  });

  if (!parseResult.success) {
    throw new ValidationError(
      parseResult.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  const { minSeverity } = parseResult.data;
  const severityFloor = minSeverity ? (SEVERITY_THRESHOLD[minSeverity] ?? 0) : 0;

  log.info(
    { component: "dashboard", operation: "exposure-by-state", minSeverity },
    "Fetching exposure by state"
  );

  try {
    // -----------------------------------------------------------------------
    // 1. Fetch all active triggers for the tenant with rule/source data
    // -----------------------------------------------------------------------
    const triggers = await prisma.cascadeTrigger.findMany({
      where: {
        graph: { tenantId },
        status: { in: ACTIVE_STATUSES },
      },
      include: {
        rule: {
          include: {
            source: true,
          },
        },
      },
    });

    // Filter by severity threshold if provided
    const filteredTriggers = triggers.filter(
      (t) => SEVERITY_RANK[t.severity] >= severityFloor
    );

    // -----------------------------------------------------------------------
    // 2. Fetch active rules grouped by jurisdiction for the tenant
    //    Rules are shared, so we determine relevance through triggers.
    //    We also query rules directly by jurisdiction for rule count.
    // -----------------------------------------------------------------------
    const ruleIds = [...new Set(filteredTriggers.map((t) => t.ruleId))];

    const rulesWithSources = await prisma.rule.findMany({
      where: { id: { in: ruleIds } },
      include: { source: true },
    });

    // Build a jurisdiction → rule count map
    const rulesByJurisdiction = new Map<string, Set<string>>();
    for (const rule of rulesWithSources) {
      const jurisdiction = rule.jurisdiction;
      if (!rulesByJurisdiction.has(jurisdiction)) {
        rulesByJurisdiction.set(jurisdiction, new Set());
      }
      rulesByJurisdiction.get(jurisdiction)!.add(rule.id);
    }

    // -----------------------------------------------------------------------
    // 3. Group triggers by jurisdiction
    // -----------------------------------------------------------------------
    const jurisdictionMap = new Map<
      string,
      {
        triggers: typeof filteredTriggers;
        ruleCount: number;
      }
    >();

    for (const trigger of filteredTriggers) {
      const jurisdiction = trigger.rule.jurisdiction;
      if (!jurisdictionMap.has(jurisdiction)) {
        jurisdictionMap.set(jurisdiction, {
          triggers: [],
          ruleCount: rulesByJurisdiction.get(jurisdiction)?.size ?? 0,
        });
      }
      jurisdictionMap.get(jurisdiction)!.triggers.push(trigger);
    }

    // -----------------------------------------------------------------------
    // 4. Build per-jurisdiction exposure records
    // -----------------------------------------------------------------------
    const exposures: StateExposure[] = [];

    for (const [jurisdiction, data] of jurisdictionMap) {
      const jurisdictionTriggers = data.triggers;

      // SKU count — sum totalSkusAffected, but deduplicate across triggers
      // Since a single SKU may be affected by multiple triggers in the same
      // jurisdiction, we take the max from the most-impactful trigger as a
      // reasonable upper bound and then sum unique triggers' affected SKUs.
      const skusAffected = jurisdictionTriggers.reduce(
        (sum, t) => sum + t.totalSkusAffected,
        0
      );

      // Financial exposure — sum estimatedCostMax for all triggers
      const financialExposure = jurisdictionTriggers.reduce(
        (sum, t) => sum + Number(t.estimatedCostMax ?? 0),
        0
      );

      // Most severe trigger
      let mostSevere: Severity | null = null;
      let highestRank = 0;
      for (const t of jurisdictionTriggers) {
        const rank = SEVERITY_RANK[t.severity];
        if (rank > highestRank) {
          highestRank = rank;
          mostSevere = t.severity;
        }
      }

      // Severity breakdown for chart consumption
      const severityCounts = new Map<Severity, number>();
      for (const t of jurisdictionTriggers) {
        severityCounts.set(t.severity, (severityCounts.get(t.severity) ?? 0) + 1);
      }

      const triggerBreakdown: Array<{ severity: Severity; count: number }> = [
        "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO",
      ].map((severity) => ({
        severity: severity as Severity,
        count: severityCounts.get(severity as Severity) ?? 0,
      }));

      exposures.push({
        jurisdiction,
        activeRuleCount: data.ruleCount,
        activeTriggerCount: jurisdictionTriggers.length,
        skusAffected,
        financialExposure,
        mostSevereTrigger: mostSevere,
        triggerBreakdown,
      });
    }

    // Sort by financial exposure descending (most impactful first)
    exposures.sort((a, b) => b.financialExposure - a.financialExposure);

    const totalFinancialExposure = exposures.reduce(
      (sum, e) => sum + e.financialExposure,
      0
    );

    const response: ExposureByStateResponse = {
      exposures,
      totalJurisdictions: exposures.length,
      totalFinancialExposure,
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
      { err: error, component: "dashboard", operation: "exposure-by-state" },
      "Failed to compute exposure by state"
    );
    throw error;
  }
}
