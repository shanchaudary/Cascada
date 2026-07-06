"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Severity, TriggerStatus } from "@prisma/client";
import {
  DataTable,
  PageHeader,
  Badge,
  EmptyState,
  TableRowSkeleton,
} from "@/components/dashboard";
import type { ColumnDef } from "@/components/dashboard";
import { useDecisions } from "@/hooks";
import type { DecisionPackageSummary } from "@/types/api";
import { formatCurrency } from "@/utils/formatting";
import { formatDashboardDate } from "@/utils/dates";

// ============================================================================
// Decisions List Page
// ============================================================================

const STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "decided", label: "Decided" },
];

const SEVERITY_FILTER_OPTIONS: Array<{ value: Severity | ""; label: string }> = [
  { value: "", label: "All severities" },
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];

function decisionBadgeVariant(decision: string | null): "success" | "critical" | "warning" | "default" {
  switch (decision) {
    case "accept": return "success";
    case "reject": return "critical";
    case "defer": return "warning";
    case "partial": return "warning";
    default: return "default";
  }
}

function decisionLabel(decision: string | null): string {
  if (!decision) return "Pending";
  return decision.charAt(0).toUpperCase() + decision.slice(1);
}

export default function DecisionsPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Severity | "">("");

  const {
    data: decisionsResponse,
    isLoading,
    error,
  } = useDecisions(
    statusFilter ? (statusFilter as TriggerStatus) : undefined,
    severityFilter || undefined
  );

  const decisions = useMemo(
    () => decisionsResponse?.items ?? [],
    [decisionsResponse]
  );

  const columns: ColumnDef<DecisionPackageSummary>[] = useMemo(
    () => [
      {
        key: "title",
        header: "Title",
        accessor: (row: DecisionPackageSummary) => row.title,
        cell: (row: DecisionPackageSummary) => (
          <span className="font-medium text-slate-900 dark:text-white">{row.title}</span>
        ),
      },
      {
        key: "totalSkusAffected",
        header: "SKUs",
        accessor: (row: DecisionPackageSummary) => row.totalSkusAffected,
        align: "center",
      },
      {
        key: "estimatedCost",
        header: "Est. Cost",
        accessor: (row: DecisionPackageSummary) => row.estimatedCostMin ?? 0,
        cell: (row: DecisionPackageSummary) =>
          row.estimatedCostMin != null && row.estimatedCostMax != null
            ? `${formatCurrency(row.estimatedCostMin, { compact: true })}–${formatCurrency(row.estimatedCostMax, { compact: true })}`
            : "—",
        align: "right",
      },
      {
        key: "deadlineDate",
        header: "Deadline",
        accessor: (row: DecisionPackageSummary) => row.deadlineDate ?? "",
        cell: (row: DecisionPackageSummary) => formatDashboardDate(row.deadlineDate),
      },
      {
        key: "decision",
        header: "Decision",
        accessor: (row: DecisionPackageSummary) => row.decision ?? "",
        cell: (row: DecisionPackageSummary) => (
          <Badge variant={decisionBadgeVariant(row.decision)}>
            {decisionLabel(row.decision)}
          </Badge>
        ),
        width: "120px",
      },
      {
        key: "generatedAt",
        header: "Generated",
        accessor: (row: DecisionPackageSummary) => row.generatedAt,
        cell: (row: DecisionPackageSummary) => formatDashboardDate(row.generatedAt),
      },
    ],
    []
  );

  const handleRowClick = useCallback(
    (row: DecisionPackageSummary) => {
      router.push(`/dashboard/decisions/${row.id}`);
    },
    [router]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decision Packages"
        description="Review and act on regulatory impact decision packages"
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label htmlFor="decision-status-filter" className="sr-only">Filter by status</label>
          <select
            id="decision-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="decision-severity-filter" className="sr-only">Filter by severity</label>
          <select
            id="decision-severity-filter"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as Severity | "")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            {SEVERITY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {error ? (
        <EmptyState
          title="Failed to load decisions"
          description={error.message}
        />
      ) : isLoading ? (
        <TableRowSkeleton columns={6} rows={8} />
      ) : decisions.length === 0 ? (
        <EmptyState
          title="No decision packages"
          description="Decision packages will appear here when triggers are fully analyzed and ready for executive action."
          action={
            <a
              href="/dashboard/triggers"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              View Triggers
            </a>
          }
        />
      ) : (
        <DataTable<DecisionPackageSummary>
          columns={columns}
          data={decisions}
          rowKey={(row: DecisionPackageSummary) => row.id}
          pageSize={10}
          onRowClick={handleRowClick}
          emptyMessage="No decision packages match your filters"
        />
      )}
    </div>
  );
}
