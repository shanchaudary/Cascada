import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const hookState = vi.hoisted(() => ({
  summary: {
    totalActiveTriggers: 1,
    triggersBySeverity: [{ severity: "HIGH", count: 1 }],
    totalSkusAffected: 3,
    estimatedCostRange: { min: 100, max: 500 },
    complianceDeadlines: [{ window: "0-30 days", count: 1 }],
    pendingDecisionPackages: 2,
    activeWorkflows: 0,
    recentActivityCount: 4,
  } as unknown,
  recentTriggers: {
    triggers: [
      {
        triggerId: "recent-trigger-1",
        title: "Recent additive rule",
        severity: "HIGH",
        status: "DETECTED",
        triggerType: "REGULATORY_CHANGE",
        totalSkusAffected: 3,
        estimatedCostMin: 100,
        estimatedCostMax: 500,
        deadlineDate: "2026-12-31T00:00:00.000Z",
        createdAt: "2026-07-07T00:00:00.000Z",
      },
    ],
    total: 1,
  } as unknown,
  deadlines: {
    deadlines: [
      {
        ruleId: "rule-1",
        ruleDescription: "Compliance deadline",
        complianceDate: "2026-12-31T00:00:00.000Z",
        daysRemaining: 120,
        severity: "HIGH",
        affectedSkusCount: 3,
      },
    ],
  } as unknown,
  costs: {
    topExpensiveTriggers: [
      {
        triggerId: "trigger-1",
        title: "Costly trigger",
        estimatedCostMax: 500,
      },
    ],
  } as unknown,
  allTriggers: {
    triggers: [
      {
        id: "trigger-1",
        title: "Envelope trigger",
        severity: "HIGH",
        status: "DETECTED",
        triggerType: "REGULATORY_CHANGE",
        totalSkusAffected: 3,
        estimatedCostMin: 100,
        estimatedCostMax: 500,
        deadlineDate: "2026-12-31T00:00:00.000Z",
        createdAt: "2026-07-07T00:00:00.000Z",
      },
    ],
    total: 1,
  } as unknown,
}));

interface ChildrenProps {
  children?: React.ReactNode;
}

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ChildrenProps & { href: string }) =>
    React.createElement("a", { ...props, href }, children),
}));

vi.mock("recharts", () => {
  const Component = ({ children }: ChildrenProps) => React.createElement("div", null, children);

  return {
    Bar: Component,
    BarChart: Component,
    CartesianGrid: Component,
    Cell: Component,
    Legend: Component,
    Pie: Component,
    PieChart: Component,
    ResponsiveContainer: Component,
    Tooltip: Component,
    XAxis: Component,
    YAxis: Component,
  };
});

vi.mock("@/hooks", () => ({
  useDashboardSummary: () => ({
    data: hookState.summary,
    isLoading: false,
    error: null,
  }),
  useRecentTriggers: () => ({
    data: hookState.recentTriggers,
    isLoading: false,
  }),
  useUpcomingDeadlines: () => ({
    data: hookState.deadlines,
    isLoading: false,
  }),
  useCostEstimates: () => ({
    data: hookState.costs,
    isLoading: false,
  }),
  useCascadeTriggers: () => ({
    data: hookState.allTriggers,
  }),
}));

describe("DashboardPage render", () => {
  it("renders without crashing when dashboard hooks receive API envelopes", async () => {
    const { default: DashboardPage } = await import("@/app/dashboard/page");

    expect(() => renderToString(React.createElement(DashboardPage))).not.toThrow();
    expect(renderToString(React.createElement(DashboardPage))).toContain("Dashboard");
  });
});
