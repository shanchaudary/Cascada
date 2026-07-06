import type { ReactNode } from "react";

// ============================================================================
// Props
// ============================================================================
export interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Optional description below the title */
  description?: string;
  /** Optional action buttons rendered on the right side */
  actions?: ReactNode;
}

// ============================================================================
// PageHeader component
// ============================================================================
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="mt-3 flex shrink-0 items-center gap-3 sm:mt-0">
          {actions}
        </div>
      )}
    </div>
  );
}
