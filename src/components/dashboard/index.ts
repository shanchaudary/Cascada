// Cascada — Dashboard Component Barrel Exports
// Import all dashboard components from a single entry point.

// Layout components
export { Sidebar } from "./sidebar";
export type { SidebarProps } from "./sidebar";

export { Header } from "./header";
export type { HeaderProps } from "./header";

export { PageHeader } from "./page-header";
export type { PageHeaderProps } from "./page-header";

// Data display components
export { StatCard } from "./stat-card";
export type { StatCardProps, ChangeType } from "./stat-card";

export { TriggerCard } from "./trigger-card";
export type { TriggerCardProps } from "./trigger-card";

export { ExposureMap } from "./exposure-map";
export type { ExposureMapProps } from "./exposure-map";

// Chart components
export { CostChart } from "./cost-chart";
export type { CostChartProps, CostEstimateDataPoint } from "./cost-chart";

export { SeverityDistribution } from "./severity-distribution";
export type { SeverityDistributionProps, SeverityCount } from "./severity-distribution";

export { TimelineChart } from "./timeline-chart";
export type { TimelineChartProps } from "./timeline-chart";

// UI components
export { DataTable } from "./data-table";
export type { DataTableProps, ColumnDef } from "./data-table";

export { Badge } from "./badge";
export type { BadgeProps, BadgeVariant } from "./badge";

export {
  CardSkeleton,
  TableRowSkeleton,
  ChartSkeleton,
  PageSkeleton,
} from "./loading-skeleton";
export type {
  CardSkeletonProps,
  TableRowSkeletonProps,
  ChartSkeletonProps,
  PageSkeletonProps,
} from "./loading-skeleton";

export { EmptyState } from "./empty-state";
export type { EmptyStateProps } from "./empty-state";

export { ConfirmDialog } from "./confirm-dialog";
export type { ConfirmDialogProps } from "./confirm-dialog";

export { NotificationToast, useToast } from "./notification-toast";
