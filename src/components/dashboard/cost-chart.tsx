"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/utils/formatting";

// ============================================================================
// Data types
// ============================================================================
export interface CostEstimateDataPoint {
  /** Category label (e.g., "California AB 418") */
  name: string;
  /** Reformulation costs */
  reformulation: number;
  /** Label change costs */
  labelChange: number;
  /** Product withdrawal costs */
  withdrawal: number;
  /** Penalty costs */
  penalty: number;
}

export interface CostChartProps {
  /** Array of cost estimate data points */
  data: CostEstimateDataPoint[];
  /** Show loading skeleton */
  isLoading?: boolean;
}

// ============================================================================
// Custom tooltip
// ============================================================================
interface TooltipPayloadEntry {
  color: string;
  value: number;
  dataKey: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <p className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
        {label}
      </p>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                {entry.dataKey === "labelChange"
                  ? "Label Change"
                  : entry.dataKey.replace(/([A-Z])/g, " $1").trim()}
              </span>
            </div>
            <span className="text-xs font-semibold text-slate-900 dark:text-white">
              {formatCurrency(entry.value, { compact: true })}
            </span>
          </div>
        ))}
        <div className="mt-1.5 border-t border-slate-200 pt-1.5 dark:border-slate-700">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total
            </span>
            <span className="text-xs font-bold text-slate-900 dark:text-white">
              {formatCurrency(
                payload.reduce((sum, entry) => sum + entry.value, 0),
                { compact: true }
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Color configuration
// ============================================================================
const BAR_COLORS = {
  reformulation: "#3b82f6", // blue-500
  labelChange: "#f59e0b",   // amber-500
  withdrawal: "#ef4444",    // red-500
  penalty: "#8b5cf6",       // violet-500
} as const;

// ============================================================================
// CostChart component
// ============================================================================
export function CostChart({ data, isLoading = false }: CostChartProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-4 h-5 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-64 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">
        Cost Estimation by Trigger
      </h2>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e2e8f0"
              className="dark:opacity-20"
            />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: "#64748b" }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              angle={-30}
              textAnchor="end"
              height={60}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#64748b" }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              tickFormatter={(value: number) => formatCurrency(value, { compact: true })}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              formatter={(value: string) =>
                value === "labelChange"
                  ? "Label Change"
                  : value.replace(/([A-Z])/g, " $1").trim().replace(/^\w/, (c) => c.toUpperCase())
              }
            />
            <Bar
              dataKey="reformulation"
              stackId="costs"
              fill={BAR_COLORS.reformulation}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="labelChange"
              stackId="costs"
              fill={BAR_COLORS.labelChange}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="withdrawal"
              stackId="costs"
              fill={BAR_COLORS.withdrawal}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="penalty"
              stackId="costs"
              fill={BAR_COLORS.penalty}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
