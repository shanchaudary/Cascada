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
import { useCascadeTriggers } from "@/hooks";
import type { CascadeTriggerSummary } from "@/types/api";
import { formatCurrency } from "@/utils/formatting";
import { formatDashboardDate, daysUntilDeadline } from "@/utils/dates";

// ============================================================================
// Triggers List Page
// ============================================================================

const SEVERITY_FILTER_OPTIONS: Array<{ value: Severity | ""; label: string }> = [
  { value: "", label: "All severities" },
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
  { value: "INFO", label: "Info" },
];

const STATUS_FILTER_OPTIONS: Array<{ value: TriggerStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "DETECTED", label: "Detected" },
  { value: "ANALYZING", label: "Analyzing" },
  { value: "IMPACT_ASSESSED", label: "Impact Assessed" },
  { value: "DECISION_PACKAGE_READY", label: "Decision Ready" },
  { value: "DECISION_MADE", label: "Decision Made" },
  { value: "WORKFLOW_STARTED", label: "Workflow Started" },
  { value: "COMPLETED", label: "Completed" },
  { value: "DISMISSED", label: "Dismissed" },
];

function severityToBadgeVariant(severity: Severity): "critical" | "high" | "medium" | "low" | "info" {
  return severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info";
}

function statusToBadgeVariant(status: TriggerStatus): "critical" | "high" | "medium" | "low" | "info" | "success" | "warning" | "default" {
  switch (status) {
    case "DETECTED": return "warning";
    case "ANALYZING": return "info";
    case "IMPACT_ASSESSED": return "medium";
    case "DECISION_PACKAGE_READY": return "high";
    case "DECISION_MADE":
    case "COMPLETED": return "success";
    case "WORKFLOW_STARTED": return "info";
    case "DISMISSED": return "default";
    default: return "default";
  }
}

const STATUS_LABELS: Record<TriggerStatus, string> = {
  DETECTED: "Detected",
  ANALYZING: "Analyzing",
  IMPACT_ASSESSED: "Assessed",
  DECISION_PACKAGE_READY: "Decision Ready",
  DECISION_MADE: "Decided",
  WORKFLOW_STARTED: "In Progress",
  COMPLETED: "Completed",
  DISMISSED: "Dismissed",
};

export default function TriggersPage() {
  const router = useRouter();
  const [severityFilter, setSeverityFilter] = useState<Severity | "">("");
  const [statusFilter, setStatusFilter] = useState<TriggerStatus | "">("");

  const {
    data: triggers,
    isLoading,
    error,
  } = useCascadeTriggers(
    statusFilter || undefined,
    severityFilter || undefined
  );

  const columns: ColumnDef<CascadeTriggerSummary>[] = useMemo(
    () => [
      {
        key: "severity",
        header: "Severity",
        accessor: (row: CascadeTriggerSummary) => row.severity,
        cell: (row: CascadeTriggerSummary) => (
          <Badge variant={severityToBadgeVariant(row.severity)}>{row.severity}</Badge>
        ),
        width: "100px",
      },
      {
        key: "title",
        header: "Title",
        accessor: (row: CascadeTriggerSummary) => row.title,
        cell: (row: CascadeTriggerSummary) => (
          <span className="font-medium text-slate-900 dark:text-white">{row.title}</span>
        ),
      },
      {
        key: "triggerType",
        header: "Type",
        accessor: (row: CascadeTriggerSummary) => row.triggerType,
        cell: (row: CascadeTriggerSummary) => (
          <span className="text-slate-600 dark:text-slate-400">
            {row.triggerType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </span>
        ),
      },
      {
        key: "totalSkusAffected",
        header: "SKUs",
        accessor: (row: CascadeTriggerSummary) => row.totalSkusAffected,
        align: "center",
      },
      {
        key: "estimatedCost",
        header: "Est. Cost",
        accessor: (row: CascadeTriggerSummary) => row.estimatedCostMin ?? 0,
        cell: (row: CascadeTriggerSummary) =>
          row.estimatedCostMin != null && row.estimatedCostMax != null
            ? `${formatCurrency(row.estimatedCostMin, { compact: true })}–${formatCurrency(row.estimatedCostMax, { compact: true })}`
            : "—",
        align: "right",
      },
      {
        key: "deadlineDate",
        header: "Deadline",
        accessor: (row: CascadeTriggerSummary) => row.deadlineDate ?? "",
        cell: (row: CascadeTriggerSummary) => {
          const days = daysUntilDeadline(row.deadlineDate);
          const isOverdue = days !== null && days < 0;
          const isUrgent = days !== null && days >= 0 && days <= 30;
          return (
            <div>
              <span className={`text-sm ${isOverdue ? "font-semibold text-red-600 dark:text-red-400" : isUrgent ? "font-semibold text-orange-600 dark:text-orange-400" : "text-slate-700 dark:text-slate-300"}`}>
                {formatDashboardDate(row.deadlineDate)}
              </span>
              {days !== null && (
                <p className={`text-xs ${isOverdue ? "text-red-500 dark:text-red-400" : isUrgent ? "text-orange-500 dark:text-orange-400" : "text-slate-400 dark:text-slate-500"}`}>
                  {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d left`}
                </p>
              )}
            </div>
          );
        },
      },
      {
        key: "status",
        header: "Status",
        accessor: (row: CascadeTriggerSummary) => row.status,
        cell: (row: CascadeTriggerSummary) => (
          <Badge variant={statusToBadgeVariant(row.status)}>{STATUS_LABELS[row.status]}</Badge>
        ),
        width: "130px",
      },
    ],
    []
  );

  const handleRowClick = useCallback(
    (row: CascadeTriggerSummary) => {
      router.push(`/dashboard/triggers/${row.id}`);
    },
    [router]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Triggers"
        description="Regulatory triggers detected across your product portfolio"
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label htmlFor="trigger-severity-filter" className="sr-only">Filter by severity</label>
          <select
            id="trigger-severity-filter"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as Severity | "")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:focus:border-blue-500"
          >
            {SEVERITY_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="trigger-status-filter" className="sr-only">Filter by status</label>
          <select
            id="trigger-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TriggerStatus | "")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:focus:border-blue-500"
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Data table */}
      {error ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          }
          title="Failed to load triggers"
          description={error.message}
        />
      ) : isLoading ? (
        <TableRowSkeleton columns={7} rows={8} />
      ) : !triggers || triggers.length === 0 ? (
        <EmptyState
          title="No triggers found"
          description="Regulatory triggers will appear here when changes are detected that affect your product portfolio."
          action={
            <a
              href="/dashboard/regulations"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Browse Regulations
            </a>
          }
        />
      ) : (
        <DataTable<CascadeTriggerSummary>
          columns={columns}
          data={triggers}
          rowKey={(row: CascadeTriggerSummary) => row.id}
          pageSize={10}
          onRowClick={handleRowClick}
          emptyMessage="No triggers match your filters"
        />
      )}
    </div>
  );
}
