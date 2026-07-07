"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { UpcomingDeadline } from "@/types/api";
import { formatDashboardDate } from "@/utils/dates";

// ============================================================================
// Props
// ============================================================================
export interface TimelineChartProps {
  /** Array of upcoming deadlines */
  data: UpcomingDeadline[];
  /** Show loading skeleton */
  isLoading?: boolean;
}

// ============================================================================
// Urgency color logic
// ============================================================================
type UrgencyBucket = "critical" | "urgent" | "approaching" | "distant";

function getUrgencyBucket(daysRemaining: number): UrgencyBucket {
  if (daysRemaining <= 30) return "critical";
  if (daysRemaining <= 60) return "urgent";
  if (daysRemaining <= 90) return "approaching";
  return "distant";
}

const URGENCY_COLORS: Record<UrgencyBucket, string> = {
  critical: "#dc2626",
  urgent: "#f97316",
  approaching: "#eab308",
  distant: "#22c55e",
};

const URGENCY_LABELS: Record<UrgencyBucket, string> = {
  critical: "0-30 days",
  urgent: "31-60 days",
  approaching: "61-90 days",
  distant: "90+ days",
};

// ============================================================================
// Custom tooltip
// ============================================================================
interface TooltipPayloadEntry {
  value: number;
  payload: {
    title: string;
    deadline: string;
    severity: string;
    skusAffected: number;
    daysRemaining: number;
    urgency: UrgencyBucket;
  };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const firstEntry = payload[0];
  if (!firstEntry) return null;
  const item = firstEntry.payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <p className="text-sm font-semibold text-slate-900 dark:text-white">
        {item.title}
      </p>
      <div className="mt-1.5 space-y-1 text-xs text-slate-500 dark:text-slate-400">
        <p>Deadline: {formatDashboardDate(item.deadline)}</p>
        <p>
          Days remaining:{" "}
          <span
            className="font-semibold"
            style={{ color: URGENCY_COLORS[item.urgency] }}
          >
            {item.daysRemaining}
          </span>
        </p>
        <p>Severity: {item.severity}</p>
        <p>SKUs affected: {item.skusAffected.toLocaleString()}</p>
      </div>
    </div>
  );
}

// ============================================================================
// TimelineChart component
// ============================================================================
export function TimelineChart({ data, isLoading = false }: TimelineChartProps) {
  const timelineData = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-64 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  // Transform data for horizontal bar chart
  const chartData = [...timelineData]
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
    .slice(0, 15)
    .map((item) => ({
      ...item,
      urgency: getUrgencyBucket(item.daysRemaining),
      label: item.title.length > 30 ? item.title.slice(0, 30) + "..." : item.title,
    }));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Compliance Timeline
        </h2>
        {/* Urgency legend */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {(Object.entries(URGENCY_LABELS) as Array<[UrgencyBucket, string]>).map(
            ([bucket, label]) => (
              <div key={bucket} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: URGENCY_COLORS[bucket] }}
                />
                <span className="text-slate-500 dark:text-slate-400">{label}</span>
              </div>
            )
          )}
        </div>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 10, left: 10, bottom: 0 }}
            barCategoryGap="25%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e2e8f0"
              horizontal={false}
              className="dark:opacity-20"
            />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "#64748b" }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              label={{
                value: "Days Remaining",
                position: "insideBottom",
                offset: -2,
                style: { fontSize: 11, fill: "#94a3b8" },
              }}
            />
            <YAxis
              type="category"
              dataKey="label"
              tick={{ fontSize: 11, fill: "#64748b" }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              width={120}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="daysRemaining" radius={[0, 4, 4, 0]} minPointSize={3}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={URGENCY_COLORS[entry.urgency]}
                  opacity={0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
