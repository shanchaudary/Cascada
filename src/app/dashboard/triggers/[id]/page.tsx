"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  PageHeader,
  Badge,
  DataTable,
  TimelineChart,
  EmptyState,
  ConfirmDialog,
  PageSkeleton,
} from "@/components/dashboard";
import type { ColumnDef } from "@/components/dashboard";
import {
  useCascadeTriggerDetail,
  useAnalyzeTrigger,
  useCascadeImpacts,
  useUpcomingDeadlines,
} from "@/hooks";
import { useToast } from "@/components/dashboard";
import type { CascadeTriggerSummary } from "@/types/api";
import { formatCurrency } from "@/utils/formatting";
import { formatDashboardDate } from "@/utils/dates";
import type { Severity, TriggerStatus } from "@prisma/client";

// ============================================================================
// Trigger Detail Page
// ============================================================================

function severityToBadgeVariant(severity: Severity): "critical" | "high" | "medium" | "low" | "info" {
  return severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info";
}

function statusLabel(status: TriggerStatus): string {
  const labels: Record<TriggerStatus, string> = {
    DETECTED: "Detected",
    ANALYZING: "Analyzing",
    IMPACT_ASSESSED: "Impact Assessed",
    DECISION_PACKAGE_READY: "Decision Package Ready",
    DECISION_MADE: "Decision Made",
    WORKFLOW_STARTED: "Workflow Started",
    COMPLETED: "Completed",
    DISMISSED: "Dismissed",
  };
  return labels[status] ?? status;
}

// Impact item shape from the hook
interface ImpactRow {
  id: string;
  impactType: string;
  description: string;
  financialImpact: number | null;
  timelineImpact: number | null;
  reformRequired: boolean;
  reformCost: number | null;
  priority: number | null;
}

const impactColumns: ColumnDef<ImpactRow>[] = [
  {
    key: "impactType",
    header: "Type",
    accessor: (row: ImpactRow) => row.impactType,
    cell: (row: ImpactRow) => (
      <Badge variant="default">{row.impactType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</Badge>
    ),
    width: "140px",
  },
  {
    key: "description",
    header: "Description",
    accessor: (row: ImpactRow) => row.description,
  },
  {
    key: "financialImpact",
    header: "Financial Impact",
    accessor: (row: ImpactRow) => row.financialImpact ?? 0,
    cell: (row: ImpactRow) =>
      row.financialImpact != null ? formatCurrency(row.financialImpact, { compact: true }) : "—",
    align: "right",
  },
  {
    key: "reformRequired",
    header: "Reformulation",
    accessor: (row: ImpactRow) => row.reformRequired,
    cell: (row: ImpactRow) =>
      row.reformRequired ? (
        <Badge variant="warning">Required</Badge>
      ) : (
        <Badge variant="default">Not needed</Badge>
      ),
    width: "130px",
  },
  {
    key: "reformCost",
    header: "Reform Cost",
    accessor: (row: ImpactRow) => row.reformCost ?? 0,
    cell: (row: ImpactRow) =>
      row.reformCost != null ? formatCurrency(row.reformCost, { compact: true }) : "—",
    align: "right",
  },
];

export default function TriggerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const triggerId = params.id;
  const toast = useToast();

  const {
    data: trigger,
    isLoading: triggerLoading,
    error: triggerError,
  } = useCascadeTriggerDetail(triggerId);

  const {
    data: impacts,
    isLoading: impactsLoading,
  } = useCascadeImpacts(triggerId);

  const {
    data: deadlines,
  } = useUpcomingDeadlines(180);

  const analyzeMutation = useAnalyzeTrigger(triggerId);

  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);

  const handleAnalyze = useCallback(async () => {
    try {
      await analyzeMutation.mutateAsync();
      toast.success("Analysis started", "The trigger is being analyzed. This may take a moment.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start analysis";
      toast.error("Analysis failed", message);
    }
  }, [analyzeMutation, toast]);

  const handleDismiss = useCallback(() => {
    setDismissDialogOpen(false);
    toast.info("Trigger dismissed", "This trigger has been marked as dismissed.");
  }, [toast]);

  // Loading state
  if (triggerLoading) {
    return (
      <div>
        <PageHeader title="Trigger Detail" />
        <PageSkeleton showTitle={false} statCards={3} showCharts={false} />
      </div>
    );
  }

  // Error state
  if (triggerError || !trigger) {
    return (
      <div>
        <PageHeader title="Trigger Detail" />
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          }
          title="Trigger not found"
          description={triggerError?.message ?? "The requested trigger could not be loaded."}
          action={
            <button
              type="button"
              onClick={() => router.push("/dashboard/triggers")}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Back to Triggers
            </button>
          }
        />
      </div>
    );
  }

  const isDetected = trigger.status === "DETECTED";

  return (
    <div className="space-y-6">
      <PageHeader
        title={trigger.title}
        description={`Trigger ID: ${trigger.id}`}
        actions={
          <div className="flex items-center gap-3">
            {isDetected && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzeMutation.isPending}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {analyzeMutation.isPending ? "Analyzing…" : "Analyze"}
              </button>
            )}
            <button
              type="button"
              onClick={() => router.push("/dashboard/decisions")}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Create Decision Package
            </button>
            {isDetected && (
              <button
                type="button"
                onClick={() => setDismissDialogOpen(true)}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Dismiss
              </button>
            )}
          </div>
        }
      />

      {/* Overview card */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Severity</p>
            <div className="mt-1">
              <Badge variant={severityToBadgeVariant(trigger.severity)}>{trigger.severity}</Badge>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Status</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
              {statusLabel(trigger.status)}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Type</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
              {trigger.triggerType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Deadline</p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
              {formatDashboardDate(trigger.deadlineDate)}
            </p>
          </div>
        </div>

        {/* Description */}
        {trigger.description && (
          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Description</p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{trigger.description}</p>
          </div>
        )}

        {/* Cascade metrics */}
        <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-3 dark:border-slate-700">
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Cascade Depth</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{trigger.cascadeDepth}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Cascade Breadth</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{trigger.cascadeBreadth}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">SKUs Affected</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
              {trigger.totalSkusAffected.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Estimated cost */}
        {(trigger.estimatedCostMin != null || trigger.estimatedCostMax != null) && (
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Estimated Cost Range</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
              {formatCurrency(trigger.estimatedCostMin ?? 0, { compact: true })} – {formatCurrency(trigger.estimatedCostMax ?? 0, { compact: true })}
            </p>
          </div>
        )}

        {/* Affected nodes */}
        {trigger.affectedNodeIds.length > 0 && (
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Affected Nodes</p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
              {trigger.affectedNodeIds.length} nodes in the cascade graph
            </p>
          </div>
        )}
      </div>

      {/* Impacts table */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Impact Assessment</h2>
        <DataTable<ImpactRow>
          columns={impactColumns}
          data={(impacts ?? []) as ImpactRow[]}
          rowKey={(row: ImpactRow) => row.id}
          pageSize={10}
          isLoading={impactsLoading}
          emptyMessage="No impact data available. Run analysis to generate impact assessment."
        />
      </div>

      {/* Timeline */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Compliance Timeline</h2>
        <TimelineChart data={deadlines ?? []} isLoading={false} />
      </div>

      {/* Dismiss dialog */}
      <ConfirmDialog
        isOpen={dismissDialogOpen}
        title="Dismiss Trigger"
        message="Are you sure you want to dismiss this trigger? Dismissed triggers will no longer appear in active alerts but can be reviewed later."
        confirmLabel="Dismiss"
        variant="danger"
        onConfirm={handleDismiss}
        onCancel={() => setDismissDialogOpen(false)}
      />
    </div>
  );
}
