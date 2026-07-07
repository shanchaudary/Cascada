// Cascada — Structured JSON Logger (Pino)
// No console.log allowed — all logging goes through this module.
// JSON structured logs in all environments.
// Avoid pino worker transports here because Next dev bundling can rewrite
// worker paths outside the project on Windows.

import pino from "pino";

const isDevelopment = process.env["NODE_ENV"] === "development";

const logger = pino({
  level: process.env["LOG_LEVEL"] || (isDevelopment ? "debug" : "info"),
  formatters: {
    level(level) {
      return { level };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  base: {
    service: "cascada-api",
    version: process.env["APP_VERSION"] || "0.1.0",
  },
});

/**
 * Create a child logger with tenant context.
 * All log entries will include the tenantId for traceability.
 */
export function createTenantLogger(tenantId: string, userId?: string) {
  return logger.child({
    tenantId,
    ...(userId && { userId }),
  });
}

/**
 * Create a child logger for pipeline runs.
 * Tracks pipeline type and run ID for debugging.
 */
export function createPipelineLogger(pipelineType: string, runId?: string) {
  return logger.child({
    component: "pipeline",
    pipelineType,
    ...(runId && { runId }),
  });
}

/**
 * Create a child logger for LLM interactions.
 * Tracks model, task type, and token usage.
 */
export function createLlmLogger(model: string, taskType: string) {
  return logger.child({
    component: "llm",
    model,
    taskType,
  });
}

/**
 * Create a child logger for ERP sync operations.
 */
export function createErpSyncLogger(
  erpType: string,
  connectionId: string,
  entityType: string
) {
  return logger.child({
    component: "erp-sync",
    erpType,
    connectionId,
    entityType,
  });
}

/**
 * Create a child logger for cascade engine operations.
 * Tracks graph builds, traversals, scoring, and cost estimation.
 */
export function createCascadeLogger(operation: string, triggerId?: string) {
  return logger.child({
    component: "cascade",
    operation,
    ...(triggerId && { triggerId }),
  });
}

/**
 * Create a child logger for AI agent operations.
 * Tracks agent type, execution context, and tool usage.
 */
export function createAgentLogger(agentType: string, operation: string) {
  return logger.child({
    component: "agent",
    agentType,
    operation,
  });
}

/**
 * Create a child logger for Temporal workflow operations.
 * Tracks workflow type, instance ID, and activity execution.
 */
export function createWorkflowLogger(workflowType: string, workflowId?: string) {
  return logger.child({
    component: "workflow",
    workflowType,
    ...(workflowId && { workflowId }),
  });
}

export default logger;
