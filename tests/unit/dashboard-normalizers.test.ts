import { describe, expect, it } from "vitest";
import {
  buildCostChartData,
  buildSeverityDistribution,
  normalizeArray,
  normalizeCascadeTriggers,
  normalizeDashboardSummary,
  normalizeExposureByState,
  normalizePaginatedResponse,
  normalizeProductExposureResponse,
  normalizeUpcomingDeadlines,
} from "@/lib/dashboard-normalizers";

const trigger = {
  id: "trigger-1",
  title: "California additive restriction",
  severity: "HIGH",
  status: "DETECTED",
  triggerType: "REGULATORY_CHANGE",
  totalSkusAffected: 12,
  estimatedCostMin: 1000,
  estimatedCostMax: 2500,
  deadlineDate: "2026-12-31T00:00:00.000Z",
  createdAt: "2026-07-07T00:00:00.000Z",
};

describe("dashboard data normalizers", () => {
  it("keeps trigger iteration safe when triggers are missing", () => {
    expect(normalizeCascadeTriggers(undefined)).toEqual([]);
    expect(buildSeverityDistribution(undefined)).toEqual([]);
  });

  it("keeps trigger iteration safe when triggers are an empty array", () => {
    expect(normalizeCascadeTriggers([])).toEqual([]);
    expect(buildSeverityDistribution([])).toEqual([]);
  });

  it("normalizes paginated trigger items before severity iteration", () => {
    expect(normalizeCascadeTriggers({ items: [trigger], total: 1 })).toEqual([trigger]);
    expect(buildSeverityDistribution({ items: [trigger], total: 1 })).toEqual([
      { severity: "HIGH", count: 1 },
    ]);
  });

  it("normalizes API trigger envelopes before severity iteration", () => {
    expect(normalizeCascadeTriggers({ triggers: [trigger], total: 1 })).toEqual([trigger]);
    expect(buildSeverityDistribution({ triggers: [trigger], total: 1 })).toEqual([
      { severity: "HIGH", count: 1 },
    ]);
  });

  it("maps recent-trigger envelopes that use triggerId into dashboard cards", () => {
    const recentTrigger = {
      triggerId: "recent-1",
      title: "Supplier disruption",
      severity: "MEDIUM",
      status: "IMPACT_ASSESSED",
      triggerType: "SUPPLIER_DISRUPTION",
      totalSkusAffected: 4,
      estimatedCostMin: null,
      estimatedCostMax: null,
      deadlineDate: null,
      createdAt: "2026-07-07T00:00:00.000Z",
    };

    expect(normalizeCascadeTriggers({ triggers: [recentTrigger], total: 1 })).toEqual([
      {
        id: "recent-1",
        title: "Supplier disruption",
        severity: "MEDIUM",
        status: "IMPACT_ASSESSED",
        triggerType: "SUPPLIER_DISRUPTION",
        totalSkusAffected: 4,
        estimatedCostMin: null,
        estimatedCostMax: null,
        deadlineDate: null,
        createdAt: "2026-07-07T00:00:00.000Z",
      },
    ]);
  });

  it("normalizes current dashboard summary envelopes into card fields", () => {
    expect(
      normalizeDashboardSummary({
        totalActiveTriggers: 3,
        triggersBySeverity: [
          { severity: "CRITICAL", count: 1 },
          { severity: "HIGH", count: 2 },
        ],
        totalSkusAffected: 20,
        estimatedCostRange: { min: 100, max: 400 },
        complianceDeadlines: [{ window: "0-30 days", count: 2 }],
        pendingDecisionPackages: 5,
        activeWorkflows: 1,
        recentActivityCount: 7,
      }),
    ).toMatchObject({
      activeTriggers: 3,
      criticalTriggers: 1,
      skusAtRisk: 20,
      revenueAtRisk: 400,
      upcomingDeadlines: 2,
      pendingDecisions: 5,
      activeWorkflows: 1,
    });
  });

  it("normalizes deadline and cost envelopes used by the hydrated dashboard", () => {
    expect(
      normalizeUpcomingDeadlines({
        deadlines: [
          {
            ruleId: "rule-1",
            ruleDescription: "State disclosure update",
            complianceDate: "2026-10-01T00:00:00.000Z",
            daysRemaining: 86,
            severity: null,
            affectedSkusCount: 9,
          },
        ],
      }),
    ).toEqual([
      {
        id: "rule-1",
        title: "State disclosure update",
        deadline: "2026-10-01T00:00:00.000Z",
        severity: "INFO",
        skusAffected: 9,
        daysRemaining: 86,
      },
    ]);

    expect(
      buildCostChartData({
        topExpensiveTriggers: [
          {
            triggerId: "trigger-1",
            title: "California additive restriction",
            estimatedCostMax: 2500,
          },
        ],
      }),
    ).toEqual([
      {
        name: "California additive restriction",
        reformulation: 2500,
        labelChange: 0,
        withdrawal: 0,
        penalty: 0,
      },
    ]);
  });

  it("normalizes state exposure envelopes before ExposureMap receives data", () => {
    expect(
      normalizeExposureByState({
        exposures: [
          {
            jurisdiction: "California",
            activeRuleCount: 2,
            activeTriggerCount: 3,
            skusAffected: 12,
            financialExposure: 250000,
            mostSevereTrigger: "HIGH",
            triggerBreakdown: [
              { severity: "HIGH", count: 2 },
              { severity: "LOW", count: 1 },
            ],
          },
        ],
        totalJurisdictions: 1,
      }),
    ).toEqual([
      {
        state: "California",
        jurisdiction: "California",
        skuCount: 12,
        revenueAtRisk: 250000,
        regulationCount: 2,
        topRegulations: [
          { id: "California-high-triggers", name: "2 high triggers", severity: "HIGH" },
          { id: "California-low-triggers", name: "1 low trigger", severity: "LOW" },
        ],
      },
    ]);

    expect(normalizeExposureByState(undefined)).toEqual([]);
    expect(normalizeExposureByState({ items: [] })).toEqual([]);
  });

  it("normalizes product exposure envelopes into paginated dashboard table rows", () => {
    expect(
      normalizeProductExposureResponse({
        products: [
          {
            productId: "product-1",
            productName: "Chocolate Bar",
            sku: "CHOCO-1",
            category: "Confection",
            brand: "Demo",
            matchedRuleSubstances: 4,
            activeTriggerCount: 2,
            reformulationCost: 7500,
          },
        ],
        totalProducts: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      }),
    ).toMatchObject({
      items: [
        {
          id: "product-1",
          name: "Chocolate Bar",
          sku: "CHOCO-1",
          category: "Confection",
          brand: "Demo",
          activeTriggers: 2,
          pendingRegulations: 4,
          reformulationCost: 7500,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it("normalizes common paginated and list envelopes used by dashboard pages", () => {
    expect(
      normalizePaginatedResponse<{ id: string }>({
        decisions: [{ id: "decision-1" }],
        pagination: { page: 2, limit: 10, totalItems: 11, totalPages: 2 },
      }, ["items", "decisions", "data"]),
    ).toEqual({
      items: [{ id: "decision-1" }],
      total: 11,
      page: 2,
      limit: 10,
      totalPages: 2,
    });

    expect(normalizeArray<{ id: string }>({ users: [{ id: "user-1" }] }, ["users"])).toEqual([
      { id: "user-1" },
    ]);
    expect(normalizeArray(undefined)).toEqual([]);
    expect(normalizeArray(null)).toEqual([]);
    expect(normalizeArray({ data: [] })).toEqual([]);
    expect(normalizeArray({ items: [] })).toEqual([]);
  });
});
