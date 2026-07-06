// Cascada — Date Utilities

/**
 * Calculate the number of days between two dates.
 * Returns negative if the end date is in the past.
 */
export function daysBetween(start: Date | string, end: Date | string): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate days remaining until a deadline from now.
 * Returns negative if the deadline has passed.
 */
export function daysUntilDeadline(deadline: Date | string | null): number | null {
  if (!deadline) return null;
  return daysBetween(new Date(), deadline);
}

/**
 * Format a date as a human-readable relative time.
 * E.g., "3 days ago", "in 2 weeks", "yesterday"
 */
export function formatRelativeTime(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";
  if (diffDays > 0 && diffDays < 7) return `in ${diffDays} days`;
  if (diffDays < 0 && diffDays > -7) return `${Math.abs(diffDays)} days ago`;
  if (diffDays > 0 && diffDays < 30) return `in ${Math.round(diffDays / 7)} weeks`;
  if (diffDays < 0 && diffDays > -30) return `${Math.round(Math.abs(diffDays) / 7)} weeks ago`;
  if (diffDays > 0 && diffDays < 365) return `in ${Math.round(diffDays / 30)} months`;
  if (diffDays < 0 && diffDays > -365) return `${Math.round(Math.abs(diffDays) / 30)} months ago`;
  if (diffDays > 0) return `in ${Math.round(diffDays / 365)} years`;
  return `${Math.round(Math.abs(diffDays) / 365)} years ago`;
}

/**
 * Format a date for display in the dashboard.
 * Returns "MMM D, YYYY" format, e.g., "Jan 15, 2025"
 */
export function formatDashboardDate(date: Date | string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Format a date with time for detailed views.
 * Returns "MMM D, YYYY h:mm AM/PM" format.
 */
export function formatDateTime(date: Date | string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Check if a deadline is urgent (within the specified number of days).
 */
export function isUrgentDeadline(
  deadline: Date | string | null,
  urgentThresholdDays: number = 30
): boolean {
  if (!deadline) return false;
  const days = daysUntilDeadline(deadline);
  return days !== null && days >= 0 && days <= urgentThresholdDays;
}

/**
 * Check if a deadline has passed.
 */
export function isOverdue(deadline: Date | string | null): boolean {
  if (!deadline) return false;
  const days = daysUntilDeadline(deadline);
  return days !== null && days < 0;
}

/**
 * Get the quarter and year for a date.
 * E.g., "Q1 2025"
 */
export function getQuarter(date: Date | string): string {
  const d = new Date(date);
  const quarter = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${quarter} ${d.getFullYear()}`;
}

/**
 * Generate a date range for compliance timeline queries.
 * Returns start and end dates for the next N months.
 */
export function getComplianceWindow(months: number = 12): { start: Date; end: Date } {
  const start = new Date();
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return { start, end };
}

/**
 * Format a Date as YYYY-MM-DD string.
 * Safe alternative to `toISOString().split("T")[0]` which can return undefined
 * under strict TypeScript configuration.
 */
export function toDateString(date: Date): string {
  const iso = date.toISOString();
  return iso.substring(0, iso.indexOf("T"));
}
