import type { ReactNode } from "react";

// ============================================================================
// Badge variants
// ============================================================================
export type BadgeVariant =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "info"
  | "success"
  | "warning"
  | "default";

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  critical:
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  high:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  medium:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  low:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  info:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  success:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  warning:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  default:
    "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

// ============================================================================
// Props
// ============================================================================
export interface BadgeProps {
  /** Visual style variant */
  variant?: BadgeVariant;
  /** Badge content */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Badge component
// ============================================================================
export function Badge({ variant = "default", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5 ${VARIANT_STYLES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
