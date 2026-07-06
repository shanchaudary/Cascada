"use client";

import Link from "next/link";
import type { Severity, TriggerStatus } from "@prisma/client";
import type { CascadeTriggerSummary } from "@/types/api";
import { formatCurrency } from "@/utils/formatting";
import { formatDashboardDate, daysUntilDeadline } from "@/utils/dates";
import { Badge } from "./badge";

// ============================================================================
// Severity color mapping
// ============================================================================
const SEVERITY_CARD_BORDER: Record<Severity, string> = {
  CRITICAL: "border-l-red-500 dark:border-l-red-400",
  HIGH: "border-l-orange-500 dark:border-l-orange-400",
  MEDIUM: "border-l-yellow-500 dark:border-l-yellow-400",
  LOW: "border-l-green-500 dark:border-l-green-400",
  INFO: "border-l-blue-500 dark:border-l-blue-400",
};

// ============================================================================
// Status label mapping
// ============================================================================
const STATUS_LABELS: Record<TriggerStatus, string> = {
  DETECTED: "Detected",
  ANALYZING: "Analyzing",
  IMPACT_ASSESSED: "Impact Assessed",
  DECISION_PACKAGE_READY: "Decision Ready",
  DECISION_MADE: "Decision Made",
  WORKFLOW_STARTED: "Workflow Started",
  COMPLETED: "Completed",
  DISMISSED: "Dismissed",
};

function statusToBadgeVariant(status: TriggerStatus): "critical" | "high" | "medium" | "low" | "info" | "success" | "warning" | "default" {
  switch (status) {
    case "DETECTED":
      return "warning";
    case "ANALYZING":
      return "info";
    case "IMPACT_ASSESSED":
      return "medium";
    case "DECISION_PACKAGE_READY":
      return "high";
    case "DECISION_MADE":
    case "COMPLETED":
      return "success";
    case "WORKFLOW_STARTED":
      return "info";
    case "DISMISSED":
      return "default";
    default:
      return "default";
  }
}

function severityToBadgeVariant(severity: Severity): "critical" | "high" | "medium" | "low" | "info" {
  return severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info";
}

// ============================================================================
// Props
// ============================================================================
export interface TriggerCardProps {
  /** The trigger data to display */
  trigger: CascadeTriggerSummary;
}

// ============================================================================
// TriggerCard component
// ============================================================================
export function TriggerCard({ trigger }: TriggerCardProps) {
  const {
    id,
    title,
    severity,
    status,
    triggerType,
    totalSkusAffected,
    estimatedCostMin,
    estimatedCostMax,
    deadlineDate,
  } = trigger;

  const borderClass = SEVERITY_CARD_BORDER[severity];
  const deadlineDays = daysUntilDeadline(deadlineDate);
  const isOverdue = deadlineDays !== null && deadlineDays < 0;
  const isUrgent = deadlineDays !== null && deadlineDays >= 0 && deadlineDays <= 30;

  return (
    <Link
      href={`/dashboard/triggers/${id}`}
      className={`group block rounded-lg border border-slate-200 border-l-4 bg-white p-5 shadow-sm transition-all hover:shadow-md dark:border-slate-700 dark:bg-slate-900 ${borderClass}`}
      aria-label={`Trigger: ${title}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-900 group-hover:text-blue-600 dark:text-white dark:group-hover:text-blue-400">
            {title}
          </h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {triggerType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={severityToBadgeVariant(severity)}>{severity}</Badge>
          <Badge variant={statusToBadgeVariant(status)}>{STATUS_LABELS[status]}</Badge>
        </div>
      </div>

      {/* Metrics row */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        {/* SKUs affected */}
        <div>
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500">SKUs Affected</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">
            {totalSkusAffected.toLocaleString()}
          </p>
        </div>

        {/* Estimated cost */}
        <div>
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Est. Cost</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">
            {estimatedCostMin != null && estimatedCostMax != null
              ? `${formatCurrency(estimatedCostMin, { compact: true })}–${formatCurrency(estimatedCostMax, { compact: true })}`
              : "—"}
          </p>
        </div>

        {/* Deadline */}
        <div>
          <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Deadline</p>
          <p
            className={`mt-0.5 text-sm font-semibold ${
              isOverdue
                ? "text-red-600 dark:text-red-400"
                : isUrgent
                  ? "text-orange-600 dark:text-orange-400"
                  : "text-slate-900 dark:text-white"
            }`}
          >
            {formatDashboardDate(deadlineDate)}
          </p>
          {deadlineDays !== null && (
            <p
              className={`text-xs ${
                isOverdue
                  ? "text-red-500 dark:text-red-400"
                  : isUrgent
                    ? "text-orange-500 dark:text-orange-400"
                    : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {isOverdue
                ? `${Math.abs(deadlineDays)} days overdue`
                : `${deadlineDays} days remaining`}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
