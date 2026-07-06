"use client";

import { useState, useMemo, useCallback } from "react";
import type { SourceStatus, SourceType, RuleType } from "@prisma/client";
import {
  DataTable,
  PageHeader,
  Badge,
  EmptyState,
  TableRowSkeleton,
  useToast,
} from "@/components/dashboard";
import type { ColumnDef } from "@/components/dashboard";
import {
  useRegulatorySources,
  useRegulatoryRules,
  useProcessSource,
  useValidateSource,
} from "@/hooks";
import { formatDashboardDate } from "@/utils/dates";
import { formatJurisdiction } from "@/utils/formatting";

// ============================================================================
// Regulations Page — Sources + Rules tabs
// ============================================================================

type TabId = "sources" | "rules";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "sources", label: "Sources" },
  { id: "rules", label: "Rules" },
];

const SOURCE_STATUS_OPTIONS: Array<{ value: SourceStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "DETECTED", label: "Detected" },
  { value: "PROCESSING", label: "Processing" },
  { value: "PARSED", label: "Parsed" },
  { value: "SME_REVIEW", label: "SME Review" },
  { value: "SME_APPROVED", label: "SME Approved" },
  { value: "SME_REJECTED", label: "SME Rejected" },
  { value: "ACTIVE", label: "Active" },
  { value: "REPEALED", label: "Repealed" },
  { value: "SUPERSEDED", label: "Superseded" },
  { value: "ENJOINDED", label: "Enjoined" },
];

const JURISDICTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All jurisdictions" },
  { value: "US", label: "Federal (US)" },
  { value: "US-CA", label: "California" },
  { value: "US-NY", label: "New York" },
  { value: "US-TX", label: "Texas" },
  { value: "US-WA", label: "Washington" },
];

function sourceStatusToBadgeVariant(status: SourceStatus): "critical" | "high" | "medium" | "low" | "info" | "success" | "warning" | "default" {
  switch (status) {
    case "DETECTED": return "default";
    case "PROCESSING": return "warning";
    case "PARSED": return "info";
    case "SME_REVIEW": return "medium";
    case "SME_APPROVED": return "success";
    case "SME_REJECTED": return "critical";
    case "ACTIVE": return "success";
    case "REPEALED": return "default";
    case "SUPERSEDED": return "default";
    case "ENJOINDED": return "warning";
    default: return "default";
  }
}

// Source row shape from the hook
interface SourceRow {
  id: string;
  sourceType: SourceType;
  jurisdiction: string;
  name: string;
  sourceUrl: string | null;
  status: SourceStatus;
  effectiveDate: string | null;
  processedAt: string | null;
  processingError: string | null;
  createdAt: string;
}

// Rule row shape from the hook
interface RuleRow {
  id: string;
  sourceId: string;
  version: number;
  jurisdiction: string;
  ruleType: RuleType;
  description: string;
  effectiveDate: string | null;
  complianceDate: string | null;
  penaltyType: string | null;
  penaltyAmount: number | null;
  smeValidatedBy: string | null;
  createdAt: string;
}

export default function RegulationsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("sources");
  const [sourceStatusFilter, setSourceStatusFilter] = useState<SourceStatus | "">("");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("");

  const toast = useToast();

  const {
    data: sourcesResponse,
    isLoading: sourcesLoading,
    error: sourcesError,
  } = useRegulatorySources(sourceStatusFilter || undefined);

  const {
    data: rulesResponse,
    isLoading: rulesLoading,
    error: rulesError,
  } = useRegulatoryRules(jurisdictionFilter || undefined);

  const sources = useMemo(() => sourcesResponse?.items ?? [], [sourcesResponse]);
  const rules = useMemo(() => rulesResponse?.items ?? [], [rulesResponse]);

  // Source columns
  const sourceColumns: ColumnDef<SourceRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        accessor: (row: SourceRow) => row.name,
        cell: (row: SourceRow) => (
          <div>
            <p className="font-medium text-slate-900 dark:text-white">{row.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{row.sourceType}</p>
          </div>
        ),
      },
      {
        key: "jurisdiction",
        header: "Jurisdiction",
        accessor: (row: SourceRow) => row.jurisdiction,
        cell: (row: SourceRow) => formatJurisdiction(row.jurisdiction),
      },
      {
        key: "status",
        header: "Status",
        accessor: (row: SourceRow) => row.status,
        cell: (row: SourceRow) => (
          <Badge variant={sourceStatusToBadgeVariant(row.status)}>
            {row.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </Badge>
        ),
        width: "130px",
      },
      {
        key: "effectiveDate",
        header: "Effective",
        accessor: (row: SourceRow) => row.effectiveDate ?? "",
        cell: (row: SourceRow) => formatDashboardDate(row.effectiveDate),
      },
      {
        key: "processedAt",
        header: "Processed",
        accessor: (row: SourceRow) => row.processedAt ?? "",
        cell: (row: SourceRow) => formatDashboardDate(row.processedAt),
      },
      {
        key: "actions",
        header: "",
        accessor: () => "",
        cell: (row: SourceRow) => (
          <SourceActions sourceId={row.id} status={row.status} />
        ),
        width: "180px",
      },
    ],
    []
  );

  // Rule columns
  const ruleColumns: ColumnDef<RuleRow>[] = useMemo(
    () => [
      {
        key: "description",
        header: "Description",
        accessor: (row: RuleRow) => row.description,
        cell: (row: RuleRow) => (
          <p className="max-w-xs truncate text-slate-900 dark:text-white">{row.description}</p>
        ),
      },
      {
        key: "jurisdiction",
        header: "Jurisdiction",
        accessor: (row: RuleRow) => row.jurisdiction,
        cell: (row: RuleRow) => formatJurisdiction(row.jurisdiction),
      },
      {
        key: "ruleType",
        header: "Type",
        accessor: (row: RuleRow) => row.ruleType,
        cell: (row: RuleRow) => (
          <Badge variant="default">{row.ruleType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</Badge>
        ),
        width: "140px",
      },
      {
        key: "effectiveDate",
        header: "Effective",
        accessor: (row: RuleRow) => row.effectiveDate ?? "",
        cell: (row: RuleRow) => formatDashboardDate(row.effectiveDate),
      },
      {
        key: "complianceDate",
        header: "Compliance",
        accessor: (row: RuleRow) => row.complianceDate ?? "",
        cell: (row: RuleRow) => formatDashboardDate(row.complianceDate),
      },
      {
        key: "validated",
        header: "Validated",
        accessor: (row: RuleRow) => row.smeValidatedBy ?? "",
        cell: (row: RuleRow) =>
          row.smeValidatedBy ? (
            <Badge variant="success">Yes</Badge>
          ) : (
            <Badge variant="default">No</Badge>
          ),
        width: "100px",
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regulations"
        description="Manage regulatory sources and parsed compliance rules"
      />

      {/* Tab bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          {activeTab === "sources" && (
            <div>
              <label htmlFor="source-status-filter" className="sr-only">Filter by status</label>
              <select
                id="source-status-filter"
                value={sourceStatusFilter}
                onChange={(e) => setSourceStatusFilter(e.target.value as SourceStatus | "")}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {SOURCE_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}
          {activeTab === "rules" && (
            <div>
              <label htmlFor="rule-jurisdiction-filter" className="sr-only">Filter by jurisdiction</label>
              <select
                id="rule-jurisdiction-filter"
                value={jurisdictionFilter}
                onChange={(e) => setJurisdictionFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                {JURISDICTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "sources" ? (
        <div>
          {sourcesError ? (
            <EmptyState
              title="Failed to load sources"
              description={sourcesError.message}
            />
          ) : sourcesLoading ? (
            <TableRowSkeleton columns={6} rows={8} />
          ) : sources.length === 0 ? (
            <EmptyState
              title="No regulatory sources"
              description="Regulatory sources will appear here when the pipeline discovers new legislation or rules."
            />
          ) : (
            <DataTable<SourceRow>
              columns={sourceColumns}
              data={sources as SourceRow[]}
              rowKey={(row: SourceRow) => row.id}
              pageSize={10}
              emptyMessage="No sources match your filters"
            />
          )}
        </div>
      ) : (
        <div>
          {rulesError ? (
            <EmptyState
              title="Failed to load rules"
              description={rulesError.message}
            />
          ) : rulesLoading ? (
            <TableRowSkeleton columns={6} rows={8} />
          ) : rules.length === 0 ? (
            <EmptyState
              title="No parsed rules"
              description="Compliance rules will appear here after regulatory sources are processed."
            />
          ) : (
            <DataTable<RuleRow>
              columns={ruleColumns}
              data={rules as RuleRow[]}
              rowKey={(row: RuleRow) => row.id}
              pageSize={10}
              emptyMessage="No rules match your filters"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Source action buttons — Process / Validate
// ============================================================================

function SourceActions({ sourceId, status }: { sourceId: string; status: SourceStatus }) {
  const toast = useToast();
  const processMutation = useProcessSource(sourceId);
  const validateMutation = useValidateSource(sourceId);

  const canProcess = status === "DETECTED" || status === "SME_REJECTED";
  const canValidate = status === "PARSED" || status === "SME_REVIEW";

  const handleProcess = useCallback(async () => {
    try {
      await processMutation.mutateAsync();
      toast.success("Processing started", "The regulatory source is being processed.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Processing failed";
      toast.error("Processing failed", message);
    }
  }, [processMutation, toast]);

  const handleValidate = useCallback(async () => {
    try {
      await validateMutation.mutateAsync();
      toast.success("Validation complete", "The source has been validated by SME review.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Validation failed";
      toast.error("Validation failed", message);
    }
  }, [validateMutation, toast]);

  return (
    <div className="flex items-center gap-2">
      {canProcess && (
        <button
          type="button"
          onClick={handleProcess}
          disabled={processMutation.isPending}
          className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
        >
          {processMutation.isPending ? "Processing…" : "Process"}
        </button>
      )}
      {canValidate && (
        <button
          type="button"
          onClick={handleValidate}
          disabled={validateMutation.isPending}
          className="rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50"
        >
          {validateMutation.isPending ? "Validating…" : "Validate"}
        </button>
      )}
    </div>
  );
}
