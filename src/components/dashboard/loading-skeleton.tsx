// Cascada — Loading Skeleton Components
// Reusable skeleton loaders for cards, tables, charts, and pages.

// ============================================================================
// Base skeleton block
// ============================================================================
function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${className}`}
      aria-hidden="true"
    />
  );
}

// ============================================================================
// CardSkeleton — for stat cards and content cards
// ============================================================================
export interface CardSkeletonProps {
  /** Number of lines in the card body */
  lines?: number;
  /** Show icon placeholder */
  showIcon?: boolean;
  /** Additional class */
  className?: string;
}

export function CardSkeleton({ lines = 2, showIcon = true, className = "" }: CardSkeletonProps) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${className}`}
      role="status"
      aria-label="Loading"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-3">
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="h-8 w-20" />
          {lines > 2 && <SkeletonBlock className="h-3 w-24" />}
        </div>
        {showIcon && <SkeletonBlock className="h-10 w-10 rounded-lg" />}
      </div>
      {lines > 2 && (
        <div className="mt-4 space-y-2">
          {Array.from({ length: Math.min(lines - 2, 3) }).map((_, i) => (
            <SkeletonBlock key={i} className="h-3 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TableRowSkeleton — for table loading states
// ============================================================================
export interface TableRowSkeletonProps {
  /** Number of columns */
  columns?: number;
  /** Number of rows */
  rows?: number;
  /** Additional class */
  className?: string;
}

export function TableRowSkeleton({
  columns = 5,
  rows = 5,
  className = "",
}: TableRowSkeletonProps) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${className}`}
      role="status"
      aria-label="Loading table data"
    >
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonBlock key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex items-center gap-4 p-4">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <SkeletonBlock
                key={colIdx}
                className="h-4 flex-1"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// ChartSkeleton — for chart loading states
// ============================================================================
export interface ChartSkeletonProps {
  /** Chart height as Tailwind class (e.g. "h-64") */
  height?: string;
  /** Show title skeleton */
  showTitle?: boolean;
  /** Additional class */
  className?: string;
}

export function ChartSkeleton({
  height = "h-64",
  showTitle = false,
  className = "",
}: ChartSkeletonProps) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 ${className}`}
      role="status"
      aria-label="Loading chart"
    >
      {showTitle && <SkeletonBlock className="mb-4 h-5 w-48" />}
      <div className={`${height} w-full`}>
        {/* Simulate bar chart skeleton */}
        <div className="flex h-full items-end gap-2">
          {Array.from({ length: 8 }).map((_, i) => {
            const barHeight = 30 + ((i * 17) % 60);
            return (
              <div key={i} className="flex-1">
                <SkeletonBlock
                  className="w-full rounded-t"
                />
                <div className={`h-[${barHeight}%]`} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PageSkeleton — full page loading state
// ============================================================================
export interface PageSkeletonProps {
  /** Show page title skeleton */
  showTitle?: boolean;
  /** Number of stat cards */
  statCards?: number;
  /** Show chart area */
  showCharts?: boolean;
  /** Additional class */
  className?: string;
}

export function PageSkeleton({
  showTitle = false,
  statCards = 4,
  showCharts = true,
  className = "",
}: PageSkeletonProps) {
  return (
    <div className={`space-y-6 ${className}`} role="status" aria-label="Loading page">
      {/* Title */}
      {showTitle && (
        <div>
          <SkeletonBlock className="h-8 w-64" />
          <SkeletonBlock className="mt-2 h-4 w-96" />
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: statCards }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>

      {/* Charts */}
      {showCharts && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartSkeleton showTitle />
          <ChartSkeleton showTitle />
        </div>
      )}

      {/* Table */}
      <TableRowSkeleton />
    </div>
  );
}
