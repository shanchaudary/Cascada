"use client";

import { useState, useMemo, useCallback } from "react";
import type { Severity } from "@prisma/client";
import {
  ExposureMap,
  DataTable,
  PageHeader,
  Badge,
  EmptyState,
  ChartSkeleton,
  TableRowSkeleton,
} from "@/components/dashboard";
import type { ColumnDef } from "@/components/dashboard";
import { useExposureByState, useExposureByProduct } from "@/hooks";
import type { ProductWithExposure } from "@/types/api";
import { formatCurrency } from "@/utils/formatting";

// ============================================================================
// Exposure Page — By State / By Product tabs
// ============================================================================

type TabId = "state" | "product";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "state", label: "By State" },
  { id: "product", label: "By Product" },
];

const SEVERITY_OPTIONS: Array<{ value: Severity | ""; label: string }> = [
  { value: "", label: "All severities" },
  { value: "CRITICAL", label: "Critical" },
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
  { value: "INFO", label: "Info" },
];

function severityToBadgeVariant(severity: Severity | null): "critical" | "high" | "medium" | "low" | "info" | "default" {
  if (!severity) return "default";
  return severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info";
}

export default function ExposurePage() {
  const [activeTab, setActiveTab] = useState<TabId>("state");
  const [severityFilter, setSeverityFilter] = useState<Severity | "">("");

  const {
    data: stateData,
    isLoading: stateLoading,
    error: stateError,
  } = useExposureByState(severityFilter || undefined);

  const {
    data: productResponse,
    isLoading: productLoading,
    error: productError,
  } = useExposureByProduct();

  const productData = useMemo(
    () => productResponse?.items ?? [],
    [productResponse]
  );

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  // Product table columns
  const productColumns: ColumnDef<ProductWithExposure>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Product",
        accessor: (row: ProductWithExposure) => row.name,
        cell: (row: ProductWithExposure) => (
          <div>
            <p className="font-medium text-slate-900 dark:text-white">{row.name}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{row.sku}</p>
          </div>
        ),
      },
      {
        key: "brand",
        header: "Brand",
        accessor: (row: ProductWithExposure) => row.brand ?? "—",
      },
      {
        key: "activeTriggers",
        header: "Triggers",
        accessor: (row: ProductWithExposure) => row.activeTriggers,
        align: "center",
      },
      {
        key: "riskScore",
        header: "Risk",
        accessor: (row: ProductWithExposure) => row.riskScore ?? 0,
        cell: (row: ProductWithExposure) => {
          if (row.riskScore == null) return <span className="text-slate-400">—</span>;
          const pct = (row.riskScore * 100).toFixed(0);
          const variant = row.riskScore >= 0.7 ? "critical" : row.riskScore >= 0.4 ? "high" : "low";
          return <Badge variant={variant}>{pct}%</Badge>;
        },
        align: "center",
      },
      {
        key: "reformulationCost",
        header: "Est. Reform Cost",
        accessor: (row: ProductWithExposure) => row.reformulationCost ?? 0,
        cell: (row: ProductWithExposure) =>
          row.reformulationCost != null
            ? formatCurrency(row.reformulationCost, { compact: true })
            : "—",
        align: "right",
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exposure Analysis"
        description="Understand regulatory exposure across states and products"
      />

      {/* Tab bar + Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => handleTabChange(tab.id)}
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

        {/* Severity filter */}
        <div>
          <label htmlFor="severity-filter" className="sr-only">Filter by severity</label>
          <select
            id="severity-filter"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as Severity | "")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
          >
            {SEVERITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "state" ? (
        <div>
          {stateError ? (
            <EmptyState
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
              }
              title="Failed to load exposure data"
              description={stateError.message}
            />
          ) : !stateLoading && stateData?.length === 0 ? (
            <EmptyState
              title="No exposure data"
              description="State-level exposure data will appear once regulatory triggers are detected for your portfolio."
            />
          ) : (
            <ExposureMap data={stateData ?? []} isLoading={stateLoading} />
          )}
        </div>
      ) : (
        <div>
          {productError ? (
            <EmptyState
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
              }
              title="Failed to load product data"
              description={productError.message}
            />
          ) : !productLoading && productData.length === 0 ? (
            <EmptyState
              title="No product exposure data"
              description="Product-level exposure data will appear once your ERP data is synced and triggers are detected."
            />
          ) : productLoading ? (
            <TableRowSkeleton columns={5} rows={8} />
          ) : (
            <DataTable<ProductWithExposure>
              columns={productColumns}
              data={productData}
              rowKey={(row: ProductWithExposure) => row.id}
              pageSize={10}
              emptyMessage="No products with exposure"
            />
          )}
        </div>
      )}
    </div>
  );
}
