"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { Severity } from "@prisma/client";

// ============================================================================
// Data types
// ============================================================================
export interface SeverityCount {
  severity: Severity;
  count: number;
}

export interface SeverityDistributionProps {
  /** Array of severity counts */
  data: SeverityCount[];
  /** Show loading skeleton */
  isLoading?: boolean;
}

// ============================================================================
// Color scheme
// ============================================================================
const SEVERITY_COLORS: Record<Severity, string> = {
  CRITICAL: "#dc2626",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#22c55e",
  INFO: "#3b82f6",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFO: "Info",
};

// ============================================================================
// Custom label renderer
// ============================================================================
interface LabelRenderProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
}

function renderCustomLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  name,
}: LabelRenderProps) {
  if (percent < 0.05) return null;

  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      className="text-xs font-semibold"
    >
      {`${name} ${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

// ============================================================================
// Custom tooltip
// ============================================================================
interface TooltipPayloadEntry {
  name: string;
  value: number;
  payload: {
    severity: Severity;
    count: number;
    fill: string;
  };
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0];
  if (!entry) return null;
  const totalCount = entry.payload.count;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: entry.payload.fill }}
        />
        <span className="text-sm font-medium text-slate-900 dark:text-white">
          {SEVERITY_LABELS[entry.payload.severity]}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {totalCount} trigger{totalCount !== 1 ? "s" : ""}
      </p>
    </div>
  );
}

// ============================================================================
// SeverityDistribution component
// ============================================================================
export function SeverityDistribution({ data, isLoading = false }: SeverityDistributionProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="flex items-center justify-center">
          <div className="h-56 w-56 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  const chartData = data.map((item) => ({
    name: SEVERITY_LABELS[item.severity],
    value: item.count,
    severity: item.severity,
    fill: SEVERITY_COLORS[item.severity],
  }));

  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
        Trigger Severity Distribution
      </h2>

      <div className="flex flex-col items-center gap-6 lg:flex-row">
        {/* Chart */}
        <div className="h-56 w-56 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
                labelLine={false}
                label={renderCustomLabel}
                strokeWidth={0}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.severity} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend / Stats */}
        <div className="flex flex-col gap-2">
          {data.map((item) => {
            const percentage = total > 0 ? ((item.count / total) * 100).toFixed(1) : "0.0";
            return (
              <div key={item.severity} className="flex items-center gap-3">
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: SEVERITY_COLORS[item.severity] }}
                />
                <span className="min-w-0 text-sm text-slate-600 dark:text-slate-300">
                  {SEVERITY_LABELS[item.severity]}
                </span>
                <span className="ml-auto text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                  {item.count}
                </span>
                <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
                  ({percentage}%)
                </span>
              </div>
            );
          })}
          <div className="mt-1 border-t border-slate-200 pt-2 dark:border-slate-700">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Total
              </span>
              <span className="ml-auto text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                {total}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
