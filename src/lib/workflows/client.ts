// Cascada — Temporal Client Connection Management
// Singleton pattern for Temporal Connection and WorkflowClient.
// Provides connection lifecycle, health checks, and graceful shutdown.
// Supports both production (real Temporal cluster) and development
// (local Temporal via Docker Compose) configurations.

import {
  Connection,
  Client,
  WorkflowClient,
} from "@temporalio/client";
import { createWorkflowLogger } from "@/lib/logger";
import { TemporalConnectionError } from "@/lib/errors";
import { TEMPORAL_CONFIG } from "./types";

// ============================================================================
// Connection Singleton
// ============================================================================

const logger = createWorkflowLogger("client");

/**
 * Global reference to the Temporal Connection.
 * Reused across all client instances in the same process.
 */
let connection: Connection | undefined;
let client: Client | undefined;

/**
 * Get or create a Temporal Connection.
 * Uses environment variables for configuration:
 *   TEMPORAL_ADDRESS — Cluster address (default: localhost:7233)
 *   TEMPORAL_NAMESPACE — Namespace (default: cascada)
 *   TEMPORAL_TLS_CERT — Path to TLS certificate (optional)
 *   TEMPORAL_TLS_KEY — Path to TLS private key (optional)
 */
export async function getTemporalConnection(): Promise<Connection> {
  if (connection) {
    return connection;
  }

  const address = process.env["TEMPORAL_ADDRESS"] || "localhost:7233";
  const namespace = process.env["TEMPORAL_NAMESPACE"] || TEMPORAL_CONFIG.NAMESPACE;

  logger.info({ address, namespace }, "Connecting to Temporal cluster");

  try {
    const tlsConfig = buildTlsConfig();

    connection = await Connection.connect({
      address,
      tls: tlsConfig,
    });

    logger.info({ address, namespace }, "Connected to Temporal cluster");
    return connection;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ address, namespace, error: message }, "Failed to connect to Temporal cluster");
    throw new TemporalConnectionError(
      `Cannot connect to Temporal at ${address}: ${message}`,
      { address, namespace }
    );
  }
}

/**
 * Get or create a Temporal Client (high-level API for workflows).
 * The client wraps the connection and provides workflow start,
 * signal, query, and describe operations.
 */
export async function getTemporalClient(): Promise<Client> {
  if (client) {
    return client;
  }

  const conn = await getTemporalConnection();
  const namespace = process.env["TEMPORAL_NAMESPACE"] || TEMPORAL_CONFIG.NAMESPACE;

  client = new Client({
    connection: conn,
    namespace,
  });

  return client;
}

/**
 * Get the WorkflowClient from the Temporal Client.
 * This is the primary interface for starting and interacting with workflows.
 */
export async function getWorkflowClient(): Promise<WorkflowClient> {
  const temporalClient = await getTemporalClient();
  return temporalClient.workflow;
}

// ============================================================================
// Workflow Execution Helpers
// ============================================================================

/**
 * Describe a workflow execution by its ID.
 * Returns the current status, including state, history length, and timestamps.
 * Throws TemporalConnectionError if the workflow is not found or the
 * Temporal cluster is unreachable.
 */
export async function describeWorkflow(
  workflowId: string,
  runId?: string
): Promise<unknown> {
  const workflowClient = await getWorkflowClient();

  try {
    const handle = workflowClient.getHandle(workflowId, runId);
    return await handle.describe();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, runId, error: message }, "Failed to describe workflow");
    throw new TemporalConnectionError(
      `Failed to describe workflow ${workflowId}: ${message}`,
      { workflowId, runId }
    );
  }
}

/**
 * Check if a workflow execution is currently running.
 * Returns true if the workflow exists and has not completed, failed,
 * or been cancelled. Returns false otherwise.
 */
export async function isWorkflowRunning(workflowId: string): Promise<boolean> {
  try {
    const description = await describeWorkflow(workflowId);
    const status = (description as Record<string, unknown>)["status"] as { name: string } | undefined;
    // Temporal status values: RUNNING, COMPLETED, FAILED, CANCELLED, TERMINATED, TIMED_OUT
    return status?.name === "RUNNING";
  } catch {
    return false;
  }
}

/**
 * Terminate a running workflow execution.
 * Used when a user cancels a workflow from the UI.
 * Provides a reason for the termination in the workflow history.
 */
export async function terminateWorkflow(
  workflowId: string,
  reason: string
): Promise<void> {
  const workflowClient = await getWorkflowClient();

  try {
    const handle = workflowClient.getHandle(workflowId);
    await handle.terminate(reason);
    logger.info({ workflowId, reason }, "Workflow terminated");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, reason, error: message }, "Failed to terminate workflow");
    throw new TemporalConnectionError(
      `Failed to terminate workflow ${workflowId}: ${message}`,
      { workflowId, reason }
    );
  }
}

/**
 * Cancel a running workflow execution.
 * Unlike terminate, cancel allows the workflow to perform cleanup
 * and execute cancellation handlers before stopping.
 */
export async function cancelWorkflow(workflowId: string): Promise<void> {
  const workflowClient = await getWorkflowClient();

  try {
    const handle = workflowClient.getHandle(workflowId);
    await handle.cancel();
    logger.info({ workflowId }, "Workflow cancellation requested");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, error: message }, "Failed to cancel workflow");
    throw new TemporalConnectionError(
      `Failed to cancel workflow ${workflowId}: ${message}`,
      { workflowId }
    );
  }
}

/**
 * Send a signal to a running workflow.
 * Used for approvals, reviews, and cancellations.
 * Signals are async — the method returns immediately after
 * the signal is received by the workflow.
 */
export async function signalWorkflow(
  workflowId: string,
  signalName: string,
  signalPayload: unknown
): Promise<void> {
  const workflowClient = await getWorkflowClient();

  try {
    const handle = workflowClient.getHandle(workflowId);
    await handle.signal(signalName, signalPayload);
    logger.info({ workflowId, signalName }, "Signal sent to workflow");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, signalName, error: message }, "Failed to signal workflow");
    throw new TemporalConnectionError(
      `Failed to signal workflow ${workflowId} with ${signalName}: ${message}`,
      { workflowId, signalName }
    );
  }
}

/**
 * Query a workflow for its current status.
 * Queries are synchronous and must return a value quickly.
 * They do not affect the workflow's state.
 */
export async function queryWorkflow<T>(
  workflowId: string,
  queryName: string,
  queryArgs?: unknown[]
): Promise<T> {
  const workflowClient = await getWorkflowClient();

  try {
    const handle = workflowClient.getHandle(workflowId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (handle as any).query(queryName, ...(queryArgs ?? []));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ workflowId, queryName, error: message }, "Failed to query workflow");
    throw new TemporalConnectionError(
      `Failed to query workflow ${workflowId} with ${queryName}: ${message}`,
      { workflowId, queryName }
    );
  }
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check the health of the Temporal connection.
 * Returns true if the connection is alive and the cluster is reachable.
 * Returns false if the connection has been lost or the cluster is down.
 */
export async function isTemporalHealthy(): Promise<boolean> {
  try {
    const conn = await getTemporalConnection();
    return !!conn;
  } catch {
    return false;
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

/**
 * Close the Temporal connection gracefully.
 * Should be called during application shutdown to drain in-flight
 * requests and release resources.
 */
export async function closeTemporalConnection(): Promise<void> {
  if (connection) {
    logger.info("Closing Temporal connection");
    await connection.close();
    connection = undefined;
    client = undefined;
    logger.info("Temporal connection closed");
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Build TLS configuration from environment variables.
 * If no TLS cert/key are provided, returns undefined (no TLS).
 * This is used for production deployments that require mTLS
 * authentication with the Temporal cluster.
 */
function buildTlsConfig():
  | { clientCertPair: { crt: Buffer; key: Buffer } }
  | undefined {
  const certPath = process.env["TEMPORAL_TLS_CERT"];
  const keyPath = process.env["TEMPORAL_TLS_KEY"];

  if (certPath && keyPath) {
    const fs = require("fs") as typeof import("fs");
    return {
      clientCertPair: {
        crt: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      },
    };
  }

  return undefined;
}
