// Cascada — LLM Cost Tracker
// Tracks token usage and cost for every LLM call.
// Writes to the LlmUsageLog table for billing, budgeting, and audit.
// This is NOT optional — every generateObject() call must be logged.

import { prisma } from "@/lib/db";
import { createLlmLogger } from "@/lib/logger";
import { LlmError } from "@/lib/errors";
import type { LlmTaskType } from "./client";

// ============================================================================
// Types
// ============================================================================

export interface LlmUsageLogEntry {
  tenantId: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  taskType: LlmTaskType;
  success: boolean;
  errorMessage?: string;
  latencyMs: number;
}

// ============================================================================
// Cost logging
// ============================================================================

/**
 * Log an LLM usage entry to the database.
 * This is called after every LLM call (success or failure).
 * Failures are logged with success=false and errorMessage.
 *
 * If the database write fails, we log the error but don't throw —
 * we don't want a logging failure to break the LLM call flow.
 */
export async function logLlmUsage(entry: LlmUsageLogEntry): Promise<void> {
  const logger = createLlmLogger(entry.model, entry.taskType);

  try {
    await prisma.llmUsageLog.create({
      data: {
        tenantId: entry.tenantId,
        model: entry.model,
        promptTokens: entry.promptTokens,
        completionTokens: entry.completionTokens,
        totalTokens: entry.totalTokens,
        costUsd: entry.costUsd,
        taskType: entry.taskType,
        success: entry.success,
        errorMessage: entry.errorMessage ?? null,
        latencyMs: entry.latencyMs,
      },
    });

    logger.debug(
      {
        model: entry.model,
        taskType: entry.taskType,
        totalTokens: entry.totalTokens,
        costUsd: entry.costUsd.toFixed(6),
        success: entry.success,
      },
      "LLM usage logged"
    );
  } catch (dbError) {
    // Database write failure must not break the calling flow.
    // Log the error and continue.
    const msg = dbError instanceof Error ? dbError.message : String(dbError);
    logger.error(
      {
        error: msg,
        model: entry.model,
        taskType: entry.taskType,
      },
      "Failed to write LLM usage log to database (non-fatal)"
    );
  }
}

// ============================================================================
// Usage aggregation queries
// ============================================================================

export interface LlmUsageSummary {
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  successRate: number;
  avgLatencyMs: number;
  byModel: Record<string, {
    calls: number;
    tokens: number;
    costUsd: number;
  }>;
  byTaskType: Record<string, {
    calls: number;
    tokens: number;
    costUsd: number;
    avgLatencyMs: number;
  }>;
}

/**
 * Get LLM usage summary for a tenant over a date range.
 * Used for billing and dashboard display.
 */
export async function getLlmUsageSummary(
  tenantId: string | null,
  startDate: Date,
  endDate: Date
): Promise<LlmUsageSummary> {
  const logger = createLlmLogger("system", "cost-tracking");
  logger.info({ tenantId, startDate, endDate }, "Calculating LLM usage summary");

  const logs = await prisma.llmUsageLog.findMany({
    where: {
      ...(tenantId && { tenantId }),
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalCalls = logs.length;
  const successCalls = logs.filter((l) => l.success).length;
  const totalTokens = logs.reduce((sum, l) => sum + l.totalTokens, 0);
  const totalCostUsd = logs.reduce((sum, l) => sum + Number(l.costUsd), 0);
  const avgLatencyMs = totalCalls > 0
    ? Math.round(logs.reduce((sum, l) => sum + l.latencyMs, 0) / totalCalls)
    : 0;

  const byModel: LlmUsageSummary["byModel"] = {};
  const byTaskType: LlmUsageSummary["byTaskType"] = {};

  for (const log of logs) {
    // Aggregate by model
    if (!byModel[log.model]) {
      byModel[log.model] = { calls: 0, tokens: 0, costUsd: 0 };
    }
    byModel[log.model]!.calls += 1;
    byModel[log.model]!.tokens += log.totalTokens;
    byModel[log.model]!.costUsd += Number(log.costUsd);

    // Aggregate by task type
    if (!byTaskType[log.taskType]) {
      byTaskType[log.taskType] = { calls: 0, tokens: 0, costUsd: 0, avgLatencyMs: 0 };
    }
    byTaskType[log.taskType]!.calls += 1;
    byTaskType[log.taskType]!.tokens += log.totalTokens;
    byTaskType[log.taskType]!.costUsd += Number(log.costUsd);
    byTaskType[log.taskType]!.avgLatencyMs += log.latencyMs;
  }

  // Compute average latency per task type
  for (const key of Object.keys(byTaskType)) {
    const entry = byTaskType[key]!;
    if (entry.calls > 0) {
      entry.avgLatencyMs = Math.round(entry.avgLatencyMs / entry.calls);
    }
  }

  return {
    totalCalls,
    totalTokens,
    totalCostUsd,
    successRate: totalCalls > 0 ? successCalls / totalCalls : 0,
    avgLatencyMs,
    byModel,
    byTaskType,
  };
}

// ============================================================================
// Budget enforcement
// ============================================================================

export interface LlmBudget {
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  warningThresholdPercent: number; // Warn at this % of limit
}

const DEFAULT_BUDGET: LlmBudget = {
  dailyLimitUsd: 50,
  monthlyLimitUsd: 1000,
  warningThresholdPercent: 80,
};

/**
 * Check if an LLM call would exceed the budget.
 * Returns true if the call is allowed, false if budget is exceeded.
 */
export async function checkLlmBudget(
  tenantId: string | null,
  budget: LlmBudget = DEFAULT_BUDGET
): Promise<{ allowed: boolean; dailySpend: number; monthlySpend: number }> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [dailyLogs, monthlyLogs] = await Promise.all([
    prisma.llmUsageLog.findMany({
      where: {
        ...(tenantId && { tenantId }),
        success: true,
        createdAt: { gte: startOfDay },
      },
      select: { costUsd: true },
    }),
    prisma.llmUsageLog.findMany({
      where: {
        ...(tenantId && { tenantId }),
        success: true,
        createdAt: { gte: startOfMonth },
      },
      select: { costUsd: true },
    }),
  ]);

  const dailySpend = dailyLogs.reduce((sum, l) => sum + Number(l.costUsd), 0);
  const monthlySpend = monthlyLogs.reduce((sum, l) => sum + Number(l.costUsd), 0);

  const logger = createLlmLogger("system", "budget-check");
  logger.debug(
    {
      tenantId,
      dailySpend: dailySpend.toFixed(2),
      monthlySpend: monthlySpend.toFixed(2),
      dailyLimit: budget.dailyLimitUsd,
      monthlyLimit: budget.monthlyLimitUsd,
    },
    "LLM budget check"
  );

  const dailyExceeded = dailySpend >= budget.dailyLimitUsd;
  const monthlyExceeded = monthlySpend >= budget.monthlyLimitUsd;

  if (dailyExceeded || monthlyExceeded) {
    logger.warn(
      {
        tenantId,
        dailySpend: dailySpend.toFixed(2),
        monthlySpend: monthlySpend.toFixed(2),
        dailyLimit: budget.dailyLimitUsd,
        monthlyLimit: budget.monthlyLimitUsd,
        exceeded: dailyExceeded ? "daily" : "monthly",
      },
      "LLM budget exceeded"
    );
  }

  return {
    allowed: !dailyExceeded && !monthlyExceeded,
    dailySpend,
    monthlySpend,
  };
}
