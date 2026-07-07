"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Severity } from "@prisma/client";
import {
  StatCard,
  SeverityDistribution,
  CostChart,
  TriggerCard,
  TimelineChart,
  PageSkeleton,
  EmptyState,
  PageHeader,
} from "@/components/dashboard";
import type { SeverityCount, CostEstimateDataPoint } from "@/components/dashboard";
import {
  useDashboardSummary,
  useRecentTriggers,
  useUpcomingDeadlines,
  useCostEstimates,
  useCascadeTriggers,
} from "@/hooks";
import { formatCurrency } from "@/utils/formatting";

// ============================================================================
// Dashboard Main Page — Executive Overview
// ============================================================================

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useDashboardSummary();
  const { data: recentTriggers, isLoading: triggersLoading } = useRecentTriggers(5);
  const { data: deadlines, isLoading: deadlinesLoading } = useUpcomingDeadlines(90);
  const { data: costSummary, isLoading: costLoading } = useCostEstimates();
  const { data: allTriggers } = useCascadeTriggers();

  // Compute severity distribution from all triggers
  const severityData: SeverityCount[] = useMemo(() => {
    if (!allTriggers) return [];
    const counts: Partial<Record<Severity, number>> = {};
    for (const t of allTriggers) {
      counts[t.severity] = (counts[t.severity] ?? 0) + 1;
    }
    return (Object.entries(counts) as Array<[Severity, number]>).map(
      ([severity, count]) => ({ severity, count })
    );
  }, [allTriggers]);

  // Transform cost summary into chart data
  const costChartData: CostEstimateDataPoint[] = useMemo(() => {
    if (!costSummary) return [];
    // Group costs by trigger using reformulation + label change costs
    return costSummary.reformulationCosts.slice(0, 8).map((rc) => ({
      name: rc.ingredientName,
      reformulation: rc.bestOption?.totalCost ?? 0,
      labelChange: 0,
      withdrawal: 0,
      penalty: 0,
    }));
  }, [costSummary]);

  const isPageLoading = summaryLoading && triggersLoading && deadlinesLoading && costLoading;

  // Full page skeleton
  if (isPageLoading && !summary) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Executive overview of regulatory impact" />
        <PageSkeleton showTitle={false} statCards={4} showCharts />
      </div>
    );
  }

  // Error state
  if (summaryError && !summary) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Executive overview of regulatory impact" />
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          }
          title="Unable to load dashboard"
          description={summaryError.message || "An unexpected error occurred. Please refresh the page."}
          action={
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Refresh
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Executive overview of regulatory impact on your portfolio"
      />

      {/* Row 1: Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Triggers"
          value={summary?.activeTriggers ?? 0}
          isLoading={summaryLoading}
          severity="HIGH"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
          }
        />
        <StatCard
          label="SKUs at Risk"
          value={summary?.skusAtRisk?.toLocaleString() ?? "0"}
          isLoading={summaryLoading}
          severity="CRITICAL"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
            </svg>
          }
        />
        <StatCard
          label="Revenue at Risk"
          value={formatCurrency(summary?.revenueAtRisk ?? 0, { compact: true })}
          isLoading={summaryLoading}
          severity="HIGH"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          }
        />
        <StatCard
          label="Pending Decisions"
          value={summary?.pendingDecisions ?? 0}
          isLoading={summaryLoading}
          severity="MEDIUM"
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
            </svg>
          }
        />
      </div>

      {/* Row 2: Severity Distribution + Cost Chart */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SeverityDistribution data={severityData} isLoading={triggersLoading} />
        <CostChart data={costChartData} isLoading={costLoading} />
      </div>

      {/* Row 3: Recent Triggers + Upcoming Deadlines */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Triggers */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Recent Triggers
            </h2>
            <Link
              href="/dashboard/triggers"
              className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              View all
            </Link>
          </div>
          {triggersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          ) : !recentTriggers || recentTriggers.length === 0 ? (
            <EmptyState
              title="No recent triggers"
              description="New regulatory triggers will appear here when detected."
              action={
                <Link
                  href="/dashboard/regulations"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  Browse Regulations
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {recentTriggers.map((trigger) => (
                <TriggerCard key={trigger.id} trigger={trigger} />
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Deadlines Timeline */}
        <TimelineChart data={deadlines ?? []} isLoading={deadlinesLoading} />
      </div>
    </div>
  );
}
