// GET /api/dashboard/cost-estimates — Cost estimation data for dashboard charts
// Total cost range, breakdown by category, monthly trend, top 10 most expensive
// triggers, and reformulation vs. label change vs. withdrawal comparison.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";
import { createTenantLogger } from "@/lib/logger";
import type { ImpactType, Severity, TriggerStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface CostRange {
  min: number;
  max: number;
}

interface CostByCategory {
  category: string;
  estimatedCost: number;
  triggerCount: number;
}

interface MonthlyCostTrend {
  month: string;
  triggerCount: number;
  estimatedCostMin: number;
  estimatedCostMax: number;
}

interface TopExpensiveTrigger {
  triggerId: string;
  title: string;
  severity: Severity;
  estimatedCostMin: number;
  estimatedCostMax: number;
  totalSkusAffected: number;
  deadlineDate: string | null;
  jurisdiction: string;
}

interface CostComparison {
  category: string;
  totalCost: number;
  impactCount: number;
  averageCost: number;
}

interface CostEstimatesResponse {
  totalCostRange: CostRange;
  costBreakdownByCategory: CostByCategory[];
  monthlyTrend: MonthlyCostTrend[];
  topExpensiveTriggers: TopExpensiveTrigger[];
  reformVsLabelVsWithdrawal: CostComparison[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Impact type → human-readable category
// ---------------------------------------------------------------------------

const IMPACT_CATEGORY_MAP: Record<string, string> = {
  REFORMULATION_REQUIRED: "reformulation",
  REFORMULATION_COST: "reformulation",
  LABEL_CHANGE_REQUIRED: "label_changes",
  PRODUCT_WITHDRAWAL: "product_withdrawal",
  SUPPLY_CHAIN_DISRUPTION: "supply_chain",
  CUSTOMER_SPEC_VIOLATION: "compliance",
  REGULATORY_PENALTY: "penalties",
  SHELF_SPACE_LOSS: "market_loss",
  MARKET_ACCESS_LOSS: "market_loss",
};

const COMPARISON_CATEGORIES: Array<{
  impactTypes: ImpactType[];
  label: string;
}> = [
  {
    impactTypes: ["REFORMULATION_REQUIRED", "REFORMULATION_COST"],
    label: "Reformulation",
  },
  {
    impactTypes: ["LABEL_CHANGE_REQUIRED"],
    label: "Label Changes",
  },
  {
    impactTypes: ["PRODUCT_WITHDRAWAL"],
    label: "Product Withdrawal",
  },
];

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

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Session required to access cost estimates");
  }

  const userObj = session.user as Record<string, unknown>;
  const tenantId = userObj["tenantId"] as string | undefined;

  if (!tenantId) {
    throw new AuthorizationError("Tenant context required for cost estimates");
  }

  const log = createTenantLogger(tenantId, userObj["id"] as string | undefined);

  log.info(
    { component: "dashboard", operation: "cost-estimates" },
    "Fetching cost estimates"
  );

  try {
    // -----------------------------------------------------------------------
    // 1. Fetch all active triggers with their impacts
    // -----------------------------------------------------------------------
    const triggers = await prisma.cascadeTrigger.findMany({
      where: {
        graph: { tenantId },
        status: { in: ACTIVE_STATUSES },
      },
      include: {
        rule: {
          select: {
            jurisdiction: true,
          },
        },
        impacts: {
          select: {
            impactType: true,
            financialImpact: true,
            reformCost: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // -----------------------------------------------------------------------
    // 2. Total cost range
    // -----------------------------------------------------------------------
    let totalCostMin = 0;
    let totalCostMax = 0;

    for (const trigger of triggers) {
      totalCostMin += Number(trigger.estimatedCostMin ?? 0);
      totalCostMax += Number(trigger.estimatedCostMax ?? 0);
    }

    // -----------------------------------------------------------------------
    // 3. Cost breakdown by category (derived from impact types)
    // -----------------------------------------------------------------------
    const categoryMap = new Map<string, { cost: number; count: number }>();

    for (const trigger of triggers) {
      for (const impact of trigger.impacts) {
        const category =
          IMPACT_CATEGORY_MAP[impact.impactType] ?? "other";
        const cost = Number(impact.financialImpact ?? 0);
        const existing = categoryMap.get(category);
        if (existing) {
          existing.cost += cost;
          existing.count += 1;
        } else {
          categoryMap.set(category, { cost, count: 1 });
        }
      }
    }

    const costBreakdownByCategory: CostByCategory[] = Array.from(
      categoryMap.entries()
    )
      .map(([category, data]) => ({
        category,
        estimatedCost: data.cost,
        triggerCount: data.count,
      }))
      .sort((a, b) => b.estimatedCost - a.estimatedCost);

    // -----------------------------------------------------------------------
    // 4. Monthly cost trend (last 12 months)
    // -----------------------------------------------------------------------
    const monthMap = new Map<
      string,
      { triggerCount: number; costMin: number; costMax: number }
    >();

    // Initialize last 12 months
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      monthMap.set(key, { triggerCount: 0, costMin: 0, costMax: 0 });
    }

    for (const trigger of triggers) {
      const triggerDate = new Date(trigger.createdAt);
      const key = `${triggerDate.getFullYear()}-${String(triggerDate.getMonth() + 1).padStart(2, "0")}`;

      if (monthMap.has(key)) {
        const month = monthMap.get(key)!;
        month.triggerCount += 1;
        month.costMin += Number(trigger.estimatedCostMin ?? 0);
        month.costMax += Number(trigger.estimatedCostMax ?? 0);
      }
    }

    const monthlyTrend: MonthlyCostTrend[] = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        triggerCount: data.triggerCount,
        estimatedCostMin: data.costMin,
        estimatedCostMax: data.costMax,
      }));

    // -----------------------------------------------------------------------
    // 5. Top 10 most expensive triggers (by estimatedCostMax)
    // -----------------------------------------------------------------------
    const sortedByCost = [...triggers].sort(
      (a, b) =>
        Number(b.estimatedCostMax ?? 0) - Number(a.estimatedCostMax ?? 0)
    );

    const topExpensiveTriggers: TopExpensiveTrigger[] = sortedByCost
      .slice(0, 10)
      .map((trigger) => ({
        triggerId: trigger.id,
        title: trigger.title,
        severity: trigger.severity,
        estimatedCostMin: Number(trigger.estimatedCostMin ?? 0),
        estimatedCostMax: Number(trigger.estimatedCostMax ?? 0),
        totalSkusAffected: trigger.totalSkusAffected,
        deadlineDate: trigger.deadlineDate?.toISOString() ?? null,
        jurisdiction: trigger.rule.jurisdiction,
      }));

    // -----------------------------------------------------------------------
    // 6. Reformulation vs. Label Change vs. Withdrawal comparison
    // -----------------------------------------------------------------------
    const reformVsLabelVsWithdrawal: CostComparison[] = COMPARISON_CATEGORIES.map(
      ({ impactTypes, label }) => {
        let totalCost = 0;
        let impactCount = 0;

        for (const trigger of triggers) {
          for (const impact of trigger.impacts) {
            if (impactTypes.includes(impact.impactType)) {
              const cost = Number(
                impact.reformCost ?? impact.financialImpact ?? 0
              );
              totalCost += cost;
              impactCount += 1;
            }
          }
        }

        const averageCost = impactCount > 0 ? totalCost / impactCount : 0;

        return {
          category: label,
          totalCost,
          impactCount,
          averageCost: Math.round(averageCost * 100) / 100,
        };
      }
    );

    // -----------------------------------------------------------------------
    // Assemble response
    // -----------------------------------------------------------------------
    const response: CostEstimatesResponse = {
      totalCostRange: { min: totalCostMin, max: totalCostMax },
      costBreakdownByCategory,
      monthlyTrend,
      topExpensiveTriggers,
      reformVsLabelVsWithdrawal,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError
    ) {
      throw error;
    }
    log.error(
      { err: error, component: "dashboard", operation: "cost-estimates" },
      "Failed to compute cost estimates"
    );
    throw error;
  }
}
