"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  PageHeader,
  Badge,
  DataTable,
  EmptyState,
  ConfirmDialog,
  PageSkeleton,
  useToast,
} from "@/components/dashboard";
import type { ColumnDef } from "@/components/dashboard";
import { useDecisionDetail, useDecide, useDecisionReport } from "@/hooks";
import { formatCurrency } from "@/utils/formatting";
import { formatDashboardDate } from "@/utils/dates";

// ============================================================================
// Decision Detail Page
// ============================================================================

type DecisionAction = "accept" | "reject" | "defer" | "partial";

// Affected SKU row shape
interface SkuRow {
  sku: string;
  productName: string;
  impact: string;
  cost: number | null;
}

// Reformulation option row shape
interface ReformRow {
  ingredientName: string;
  substituteName: string;
  costDelta: number;
  feasibility: number;
  timelineDays: number;
}

// Prioritization row shape
interface PriorityRow {
  triggerId: string;
  title: string;
  riskScore: number;
  impactScore: number;
  urgencyScore: number;
  compositeScore: number;
  rank: number;
}

// Timeline event row shape
interface TimelineRow {
  date: string;
  event: string;
  jurisdiction: string;
  conflict: boolean;
}

const skuColumns: ColumnDef<SkuRow>[] = [
  { key: "sku", header: "SKU", accessor: (row: SkuRow) => row.sku, width: "120px" },
  { key: "productName", header: "Product", accessor: (row: SkuRow) => row.productName },
  { key: "impact", header: "Impact", accessor: (row: SkuRow) => row.impact },
  {
    key: "cost",
    header: "Cost",
    accessor: (row: SkuRow) => row.cost ?? 0,
    cell: (row: SkuRow) => (row.cost != null ? formatCurrency(row.cost, { compact: true }) : "—"),
    align: "right",
  },
];

const reformColumns: ColumnDef<ReformRow>[] = [
  { key: "ingredientName", header: "Ingredient", accessor: (row: ReformRow) => row.ingredientName },
  { key: "substituteName", header: "Substitute", accessor: (row: ReformRow) => row.substituteName },
  {
    key: "costDelta",
    header: "Cost Delta",
    accessor: (row: ReformRow) => row.costDelta,
    cell: (row: ReformRow) => (
      <span className={row.costDelta > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
        {row.costDelta > 0 ? "+" : ""}{formatCurrency(row.costDelta, { compact: true })}
      </span>
    ),
    align: "right",
  },
  {
    key: "feasibility",
    header: "Feasibility",
    accessor: (row: ReformRow) => row.feasibility,
    cell: (row: ReformRow) => {
      const pct = (row.feasibility * 100).toFixed(0);
      const variant = row.feasibility >= 0.8 ? "success" : row.feasibility >= 0.5 ? "warning" : "critical";
      return <Badge variant={variant}>{pct}%</Badge>;
    },
    align: "center",
  },
  {
    key: "timelineDays",
    header: "Timeline",
    accessor: (row: ReformRow) => row.timelineDays,
    cell: (row: ReformRow) => `${row.timelineDays} days`,
    align: "center",
  },
];

const priorityColumns: ColumnDef<PriorityRow>[] = [
  {
    key: "rank",
    header: "#",
    accessor: (row: PriorityRow) => row.rank,
    align: "center",
    width: "50px",
  },
  { key: "title", header: "Trigger", accessor: (row: PriorityRow) => row.title },
  {
    key: "compositeScore",
    header: "Composite",
    accessor: (row: PriorityRow) => row.compositeScore,
    cell: (row: PriorityRow) => (row.compositeScore * 100).toFixed(1),
    align: "center",
  },
  {
    key: "riskScore",
    header: "Risk",
    accessor: (row: PriorityRow) => row.riskScore,
    cell: (row: PriorityRow) => (row.riskScore * 100).toFixed(1),
    align: "center",
  },
  {
    key: "impactScore",
    header: "Impact",
    accessor: (row: PriorityRow) => row.impactScore,
    cell: (row: PriorityRow) => (row.impactScore * 100).toFixed(1),
    align: "center",
  },
  {
    key: "urgencyScore",
    header: "Urgency",
    accessor: (row: PriorityRow) => row.urgencyScore,
    cell: (row: PriorityRow) => (row.urgencyScore * 100).toFixed(1),
    align: "center",
  },
];

const timelineColumns: ColumnDef<TimelineRow>[] = [
  {
    key: "date",
    header: "Date",
    accessor: (row: TimelineRow) => row.date,
    cell: (row: TimelineRow) => formatDashboardDate(row.date),
  },
  { key: "event", header: "Event", accessor: (row: TimelineRow) => row.event },
  { key: "jurisdiction", header: "Jurisdiction", accessor: (row: TimelineRow) => row.jurisdiction },
  {
    key: "conflict",
    header: "Conflict",
    accessor: (row: TimelineRow) => row.conflict,
    cell: (row: TimelineRow) =>
      row.conflict ? <Badge variant="critical">Conflict</Badge> : <Badge variant="success">Clear</Badge>,
    width: "100px",
  },
];

export default function DecisionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const decisionId = params.id;
  const toast = useToast();

  const { data: decision, isLoading, error } = useDecisionDetail(decisionId);
  const decideMutation = useDecide(decisionId);
  const { data: report } = useDecisionReport(decisionId);

  const [confirmAction, setConfirmAction] = useState<DecisionAction | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");

  const handleDecision = useCallback(async () => {
    if (!confirmAction) return;

    try {
      await decideMutation.mutateAsync({
        decision: confirmAction,
        notes: decisionNotes.trim() || undefined,
      });
      toast.success(
        "Decision recorded",
        `You have ${confirmAction}ed this decision package.`
      );
      setConfirmAction(null);
      setDecisionNotes("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to record decision";
      toast.error("Decision failed", message);
    }
  }, [confirmAction, decisionNotes, decideMutation, toast]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Decision Package" />
        <PageSkeleton showTitle={false} statCards={3} showCharts={false} />
      </div>
    );
  }

  if (error || !decision) {
    return (
      <div>
        <PageHeader title="Decision Package" />
        <EmptyState
          title="Decision package not found"
          description={error?.message ?? "The requested decision package could not be loaded."}
          action={
            <button
              type="button"
              onClick={() => router.push("/dashboard/decisions")}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
            >
              Back to Decisions
            </button>
          }
        />
      </div>
    );
  }

  const isPending = decision.decision === null;
  const actionButtonClass = (action: DecisionAction) => {
    const base = "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
    switch (action) {
      case "accept":
        return `${base} bg-green-600 text-white hover:bg-green-700`;
      case "reject":
        return `${base} bg-red-600 text-white hover:bg-red-700`;
      case "defer":
        return `${base} border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:hover:bg-amber-900/40`;
      case "partial":
        return `${base} border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40`;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={decision.title}
        description={`Generated ${formatDashboardDate(decision.generatedAt)}`}
        actions={
          isPending ? (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setConfirmAction("accept")} className={actionButtonClass("accept")}>Accept</button>
              <button type="button" onClick={() => setConfirmAction("reject")} className={actionButtonClass("reject")}>Reject</button>
              <button type="button" onClick={() => setConfirmAction("defer")} className={actionButtonClass("defer")}>Defer</button>
              <button type="button" onClick={() => setConfirmAction("partial")} className={actionButtonClass("partial")}>Partial</button>
            </div>
          ) : undefined
        }
      />

      {/* Summary section */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Summary</h3>
            <p className="text-sm text-slate-700 dark:text-slate-300">{decision.summary}</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">Mandate Summary</h3>
            <p className="text-sm text-slate-700 dark:text-slate-300">{decision.mandateSummary}</p>
          </div>
        </div>

        {/* Recommendation */}
        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
          <h3 className="mb-1 text-sm font-semibold text-blue-800 dark:text-blue-300">Recommendation</h3>
          <p className="text-sm text-blue-700 dark:text-blue-200">{decision.recommendation}</p>
        </div>

        {/* Decision status (if already decided) */}
        {decision.decision && (
          <div className="mt-4 flex items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <Badge variant={decision.decision === "accept" ? "success" : decision.decision === "reject" ? "critical" : "warning"}>
              {decision.decision.charAt(0).toUpperCase() + decision.decision.slice(1)}
            </Badge>
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Decided by {decision.decidedBy ?? "unknown"} on {formatDashboardDate(decision.decidedAt)}
            </span>
          </div>
        )}
      </div>

      {/* Affected SKUs */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Affected SKUs</h2>
        <DataTable<SkuRow>
          columns={skuColumns}
          data={decision.affectedSkuList as SkuRow[]}
          rowKey={(row: SkuRow) => row.sku}
          pageSize={10}
          emptyMessage="No affected SKUs"
        />
      </div>

      {/* Compliance Timeline */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Compliance Timeline</h2>
        <DataTable<TimelineRow>
          columns={timelineColumns}
          data={decision.complianceTimeline as TimelineRow[]}
          rowKey={(row: TimelineRow) => `${row.date}-${row.event}`}
          pageSize={10}
          emptyMessage="No timeline events"
        />
      </div>

      {/* Reformulation Options */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Reformulation Options</h2>
        <DataTable<ReformRow>
          columns={reformColumns}
          data={decision.reformulationOptions as ReformRow[]}
          rowKey={(row: ReformRow) => `${row.ingredientName}-${row.substituteName}`}
          pageSize={10}
          emptyMessage="No reformulation options available"
        />
      </div>

      {/* Prioritization */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Trigger Prioritization</h2>
        <DataTable<PriorityRow>
          columns={priorityColumns}
          data={decision.prioritization as PriorityRow[]}
          rowKey={(row: PriorityRow) => row.triggerId}
          pageSize={10}
          emptyMessage="No prioritization data"
        />
      </div>

      {/* Report */}
      {report && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">Generated Report</h2>
          <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: report.reportHtml }}
            />
          </div>
        </div>
      )}

      {/* Decision confirmation dialog */}
      <ConfirmDialog
        isOpen={confirmAction !== null}
        title={`Confirm ${confirmAction ?? ""} decision`}
        message={
          <div className="space-y-3">
            <p>
              Are you sure you want to <strong>{confirmAction}</strong> this decision package?
              {confirmAction === "accept" && " This will initiate compliance workflows."}
              {confirmAction === "reject" && " This will close the decision package without action."}
              {confirmAction === "defer" && " This will postpone the decision for later review."}
              {confirmAction === "partial" && " This will accept some recommendations and defer others."}
            </p>
            <div>
              <label htmlFor="decision-notes" className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-400">
                Notes (optional)
              </label>
              <textarea
                id="decision-notes"
                value={decisionNotes}
                onChange={(e) => setDecisionNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:focus:border-blue-500"
                placeholder="Add any notes about this decision…"
              />
            </div>
          </div>
        }
        confirmLabel={confirmAction ? confirmAction.charAt(0).toUpperCase() + confirmAction.slice(1) : "Confirm"}
        variant={confirmAction === "reject" ? "danger" : "normal"}
        onConfirm={handleDecision}
        onCancel={() => {
          setConfirmAction(null);
          setDecisionNotes("");
        }}
      />
    </div>
  );
}
