"use client";

import type { ReactNode } from "react";
import type { Severity } from "@prisma/client";

// ============================================================================
// Props
// ============================================================================
export type ChangeType = "up" | "down" | "neutral";

export interface StatCardProps {
  /** Metric label */
  label: string;
  /** Primary value to display */
  value: string | number;
  /** Change amount (e.g., "+12%" or "-3") */
  change?: string;
  /** Direction of change for color coding */
  changeType?: ChangeType;
  /** Icon element rendered in the top-right corner */
  icon?: ReactNode;
  /** Severity level for accent color */
  severity?: Severity | null;
  /** Show loading skeleton */
  isLoading?: boolean;
}

// ============================================================================
// Severity accent styles
// ============================================================================
const SEVERITY_ACCENT: Record<Severity, string> = {
  CRITICAL: "border-l-red-500 dark:border-l-red-400",
  HIGH: "border-l-orange-500 dark:border-l-orange-400",
  MEDIUM: "border-l-yellow-500 dark:border-l-yellow-400",
  LOW: "border-l-green-500 dark:border-l-green-400",
  INFO: "border-l-blue-500 dark:border-l-blue-400",
};

const SEVERITY_ICON_BG: Record<Severity, string> = {
  CRITICAL: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  HIGH: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  MEDIUM: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
  LOW: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  INFO: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
};

const CHANGE_STYLES: Record<ChangeType, string> = {
  up: "text-red-600 dark:text-red-400",
  down: "text-green-600 dark:text-green-400",
  neutral: "text-slate-500 dark:text-slate-400",
};

const CHANGE_ICONS: Record<ChangeType, ReactNode> = {
  up: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
    </svg>
  ),
  down: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5l15 15m0 0V8.25m0 11.25H8.25" />
    </svg>
  ),
  neutral: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H6" />
    </svg>
  ),
};

// ============================================================================
// StatCard component
// ============================================================================
export function StatCard({
  label,
  value,
  change,
  changeType = "neutral",
  icon,
  severity,
  isLoading = false,
}: StatCardProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-8 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="h-10 w-10 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="mt-3 h-3 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    );
  }

  const accentClass = severity ? SEVERITY_ACCENT[severity] : "";
  const iconBgClass = severity ? SEVERITY_ICON_BG[severity] : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400";

  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900 ${accentClass} border-l-4`}
      role="region"
      aria-label={`${label}: ${value}`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {value}
          </p>
        </div>
        {icon && (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBgClass}`}>
            {icon}
          </div>
        )}
      </div>
      {change && (
        <div className="mt-3 flex items-center gap-1">
          <span className={`flex items-center gap-0.5 text-xs font-medium ${CHANGE_STYLES[changeType]}`}>
            {CHANGE_ICONS[changeType]}
            {change}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">vs last period</span>
        </div>
      )}
    </div>
  );
}
