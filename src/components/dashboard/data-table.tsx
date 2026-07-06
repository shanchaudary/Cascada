"use client";

import { useState, useMemo, useCallback } from "react";
import type { ReactNode } from "react";

// ============================================================================
// Column definition
// ============================================================================
export interface ColumnDef<T> {
  /** Unique key matching a property on T or an arbitrary identifier */
  key: string;
  /** Header label */
  header: string;
  /** Custom cell renderer. Receives the row data. */
  cell?: (row: T) => ReactNode;
  /** Accessor function to get the raw value for sorting */
  accessor: (row: T) => unknown;
  /** Optional custom sort comparator */
  sortComparator?: (a: unknown, b: unknown) => number;
  /** Column width hint */
  width?: string;
  /** Text alignment */
  align?: "left" | "center" | "right";
}

// ============================================================================
// Sort state
// ============================================================================
type SortDirection = "asc" | "desc";

interface SortState<T> {
  key: string;
  direction: SortDirection;
  accessor: (row: T) => unknown;
  comparator?: (a: unknown, b: unknown) => number;
}

// ============================================================================
// Default comparators
// ============================================================================
function defaultCompare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b);
  }

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b));
}

// ============================================================================
// Props
// ============================================================================
export interface DataTableProps<T> {
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Row data */
  data: T[];
  /** Number of rows per page */
  pageSize?: number;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Row key accessor — must be unique per row */
  rowKey: (row: T) => string;
  /** Optional row click handler */
  onRowClick?: (row: T) => void;
  /** Additional row class name */
  rowClassName?: (row: T) => string;
}

// ============================================================================
// Sort icon component
// ============================================================================
function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={`h-4 w-4 transition-colors ${
        active ? "text-blue-600 dark:text-blue-400" : "text-slate-300 dark:text-slate-600"
      }`}
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
// DataTable component
// ============================================================================
export function DataTable<T>({
  columns,
  data,
  pageSize = 10,
  isLoading = false,
  emptyMessage = "No data available",
  rowKey,
  onRowClick,
  rowClassName,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sortState, setSortState] = useState<SortState<T> | null>(null);

  // Handle sort toggle
  const handleSort = useCallback(
    (col: ColumnDef<T>) => {
      setSortState((prev) => {
        if (prev && prev.key === col.key) {
          if (prev.direction === "asc") {
            return { ...prev, direction: "desc" };
          }
          return null; // Remove sort
        }
        return {
          key: col.key,
          direction: "asc",
          accessor: col.accessor,
          comparator: col.sortComparator,
        };
      });
      setPage(0);
    },
    []
  );

  // Filter and sort
  const processedData = useMemo(() => {
    let items = [...data];

    // Search filter: check all string-convertible fields
    if (search.trim()) {
      const query = search.toLowerCase();
      items = items.filter((row) =>
        columns.some((col) => {
          const val = col.accessor(row);
          return val != null && String(val).toLowerCase().includes(query);
        })
      );
    }

    // Sort
    if (sortState) {
      const { accessor, direction, comparator } = sortState;
      items.sort((a, b) => {
        const aVal = accessor(a);
        const bVal = accessor(b);
        const cmp = comparator ? comparator(aVal, bVal) : defaultCompare(aVal, bVal);
        return direction === "asc" ? cmp : -cmp;
      });
    }

    return items;
  }, [data, search, sortState, columns]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(processedData.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const paginatedData = processedData.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize
  );

  const alignmentClass = (align?: "left" | "center" | "right"): string => {
    switch (align) {
      case "center":
        return "text-center";
      case "right":
        return "text-right";
      default:
        return "text-left";
    }
  };

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="h-8 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: pageSize }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              {columns.map((col) => (
                <div
                  key={col.key}
                  className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
                  style={{ width: col.width ?? "80px" }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {/* Search bar */}
      <div className="border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search..."
            className="h-8 w-full max-w-xs rounded-md border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
            aria-label="Search table"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" role="grid">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 font-medium text-slate-500 dark:text-slate-400 ${alignmentClass(col.align)}`}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <button
                    type="button"
                    onClick={() => handleSort(col)}
                    className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
                    aria-label={`Sort by ${col.header}`}
                  >
                    {col.header}
                    <SortIcon
                      active={sortState?.key === col.key}
                      direction={sortState?.key === col.key ? sortState.direction : "asc"}
                    />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-slate-400 dark:text-slate-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginatedData.map((row) => {
                const key = rowKey(row);
                const rowClass = rowClassName ? rowClassName(row) : "";
                return (
                  <tr
                    key={key}
                    className={`transition-colors ${
                      onRowClick
                        ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                        : "hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                    } ${rowClass}`}
                    onClick={() => onRowClick?.(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick?.(row);
                      }
                    }}
                    tabIndex={onRowClick ? 0 : undefined}
                    role={onRowClick ? "button" : undefined}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 text-slate-700 dark:text-slate-300 ${alignmentClass(col.align)}`}
                      >
                        {col.cell ? col.cell(row) : String(col.accessor(row) ?? "—")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {processedData.length > pageSize && (
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            Showing {safePage * pageSize + 1}–
            {Math.min((safePage + 1) * pageSize, processedData.length)} of{" "}
            {processedData.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="rounded-md border border-slate-200 px-3 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Previous page"
            >
              Previous
            </button>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Page {safePage + 1} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={safePage >= totalPages - 1}
              className="rounded-md border border-slate-200 px-3 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Next page"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
