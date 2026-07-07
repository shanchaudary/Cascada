"use client";

import { useState, useMemo, useCallback } from "react";
import type { Severity } from "@prisma/client";
import type { ExposureByState } from "@/types/api";
import { formatCurrency } from "@/utils/formatting";
import { Badge } from "./badge";

// ============================================================================
// Sort direction
// ============================================================================
type SortDirection = "asc" | "desc";

interface SortConfig {
  key: keyof ExposureByState;
  direction: SortDirection;
}

// ============================================================================
// Severity helper
// ============================================================================
function getSeverityForRevenue(revenue: number): Severity {
  if (revenue >= 1_000_000) return "CRITICAL";
  if (revenue >= 500_000) return "HIGH";
  if (revenue >= 100_000) return "MEDIUM";
  if (revenue > 0) return "LOW";
  return "INFO";
}

function severityRowClass(severity: Severity): string {
  switch (severity) {
    case "CRITICAL":
      return "bg-red-50/50 dark:bg-red-900/10";
    case "HIGH":
      return "bg-orange-50/50 dark:bg-orange-900/10";
    case "MEDIUM":
      return "bg-yellow-50/30 dark:bg-yellow-900/10";
    default:
      return "";
  }
}

// ============================================================================
// Props
// ============================================================================
export interface ExposureMapProps {
  /** Array of state-level exposure data */
  data: ExposureByState[];
  /** Show loading state */
  isLoading?: boolean;
}

// ============================================================================
// Column definitions
// ============================================================================
const COLUMNS: Array<{ key: keyof ExposureByState; label: string; sortable: boolean }> = [
  { key: "jurisdiction", label: "Jurisdiction", sortable: true },
  { key: "regulationCount", label: "Active Rules", sortable: true },
  { key: "skuCount", label: "Triggers", sortable: true },
  { key: "skuCount", label: "SKUs Affected", sortable: true },
  { key: "revenueAtRisk", label: "Financial Exposure", sortable: true },
];

// ============================================================================
// Sort icon
// ============================================================================
function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={`h-4 w-4 transition-colors ${active ? "text-blue-600 dark:text-blue-400" : "text-slate-300 dark:text-slate-600"}`}
      aria-hidden="true"
    >
      {direction === "asc" ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      )}
    </svg>
  );
}

// ============================================================================
// ExposureMap component
// ============================================================================
export function ExposureMap({ data, isLoading = false }: ExposureMapProps) {
  const [sort, setSort] = useState<SortConfig>({
    key: "revenueAtRisk",
    direction: "desc",
  });
  const [search, setSearch] = useState("");
  const exposureData = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const handleSort = useCallback(
    (key: keyof ExposureByState) => {
      setSort((prev) => ({
        key,
        direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
      }));
    },
    []
  );

  const filteredAndSorted = useMemo(() => {
    let items = [...exposureData];

    // Search filter
    if (search.trim()) {
      const query = search.toLowerCase();
      items = items.filter(
        (item) =>
          item.jurisdiction.toLowerCase().includes(query) ||
          item.state.toLowerCase().includes(query) ||
          item.topRegulations.some((r) => r.name.toLowerCase().includes(query))
      );
    }

    // Sort
    items.sort((a, b) => {
      const aVal = a[sort.key];
      const bVal = b[sort.key];

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sort.direction === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      const aNum = typeof aVal === "number" ? aVal : 0;
      const bNum = typeof bVal === "number" ? bVal : 0;
      return sort.direction === "asc" ? aNum - bNum : bNum - aNum;
    });

    return items;
  }, [exposureData, search, sort]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 w-12 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Regulatory Exposure by State
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {exposureData.length} jurisdictions tracked
          </p>
        </div>
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by jurisdiction..."
            className="h-8 w-56 rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
            aria-label="Filter jurisdictions"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" role="grid">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/50">
              <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={() => handleSort("jurisdiction")}
                  className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Sort by jurisdiction"
                >
                  Jurisdiction
                  <SortIcon active={sort.key === "jurisdiction"} direction={sort.direction} />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={() => handleSort("regulationCount")}
                  className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Sort by active rules"
                >
                  Active Rules
                  <SortIcon active={sort.key === "regulationCount"} direction={sort.direction} />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                SKUs Affected
              </th>
              <th className="px-4 py-3 text-right font-medium text-slate-500 dark:text-slate-400">
                <button
                  type="button"
                  onClick={() => handleSort("revenueAtRisk")}
                  className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label="Sort by financial exposure"
                >
                  Financial Exposure
                  <SortIcon active={sort.key === "revenueAtRisk"} direction={sort.direction} />
                </button>
              </th>
              <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">
                Top Regulations
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500">
                  No jurisdictions match your filter
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((item) => {
                const severity = getSeverityForRevenue(item.revenueAtRisk);
                return (
                  <tr
                    key={item.state}
                    className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${severityRowClass(severity)}`}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {item.jurisdiction}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {item.regulationCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {item.skuCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900 dark:text-white">
                      {formatCurrency(item.revenueAtRisk, { compact: true })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {item.topRegulations.slice(0, 2).map((reg) => (
                          <Badge
                            key={reg.id}
                            variant={reg.severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info"}
                          >
                            {reg.name}
                          </Badge>
                        ))}
                        {item.topRegulations.length > 2 && (
                          <Badge variant="default">
                            +{item.topRegulations.length - 2}
                          </Badge>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Summary footer */}
      {filteredAndSorted.length > 0 && (
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Showing {filteredAndSorted.length} of {exposureData.length} jurisdictions
          </span>
          <span className="text-sm font-medium text-slate-900 dark:text-white">
            Total exposure: {formatCurrency(exposureData.reduce((sum, d) => sum + d.revenueAtRisk, 0), { compact: true })}
          </span>
        </div>
      )}
    </div>
  );
}
