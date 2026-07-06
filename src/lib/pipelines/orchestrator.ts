// Cascada — Pipeline Orchestrator
// Central coordination layer for all data ingestion pipelines.
// Manages scheduling, execution, error tracking, and run history.
//
// Responsibilities:
// 1. Schedule pipeline runs based on configured intervals
// 2. Prevent overlapping runs of the same pipeline
// 3. Track pipeline health and consecutive errors
// 4. Coordinate execution order (LegiScan → Federal Register → openFDA → USDA)
// 5. Provide pipeline status and run history APIs
// 6. Auto-disable pipelines that fail too many times consecutively

import { prisma } from "@/lib/db";
import logger, { createPipelineLogger } from "@/lib/logger";
import { PipelineError } from "@/lib/errors";
import type { PipelineType, PipelineExecutionResult } from "./types";
import { legiScanClient } from "./legiscan/client";
import { openFdaClient } from "./openfda/client";
import { federalRegisterClient } from "./federal-register/client";
import { usdaClient } from "./usda/client";
import { BasePipelineClient } from "./base-client";
import type { TransformedRegulatorySource } from "./types";
import type { SourceType } from "@prisma/client";

// ============================================================================
// Pipeline schedule configuration
// ============================================================================
interface PipelineScheduleConfig {
  type: PipelineType;
  /** Minimum minutes between runs */
  minIntervalMinutes: number;
  /** Maximum consecutive errors before auto-disable */
  maxConsecutiveErrors: number;
  /** Whether the pipeline is enabled by default */
  enabledByDefault: boolean;
  /** Execution priority (lower = higher priority) */
  priority: number;
  /** Dependencies — pipelines that must complete before this one */
  dependsOn: PipelineType[];
}

const PIPELINE_SCHEDULES: PipelineScheduleConfig[] = [
  {
    type: "legiscan",
    minIntervalMinutes: 60,
    maxConsecutiveErrors: 5,
    enabledByDefault: true,
    priority: 1,
    dependsOn: [],
  },
  {
    type: "federal_register",
    minIntervalMinutes: 30,
    maxConsecutiveErrors: 5,
    enabledByDefault: true,
    priority: 2,
    dependsOn: [],
  },
  {
    type: "openfda",
    minIntervalMinutes: 30,
    maxConsecutiveErrors: 5,
    enabledByDefault: true,
    priority: 3,
    dependsOn: [],
  },
  {
    type: "usda",
    minIntervalMinutes: 1440, // Daily
    maxConsecutiveErrors: 3,
    enabledByDefault: true,
    priority: 4,
    dependsOn: [],
  },
];

// ============================================================================
// Pipeline status tracking (in-memory for fast access)
// ============================================================================
interface PipelineStatus {
  type: PipelineType;
  enabled: boolean;
  currentStatus: "idle" | "running" | "error";
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  nextRunAt: Date | null;
  consecutiveErrors: number;
  lastError: string | null;
  lastRunResult: PipelineExecutionResult | null;
}

// ============================================================================
// Pipeline Orchestrator
// ============================================================================
export class PipelineOrchestrator {
  private statuses: Map<PipelineType, PipelineStatus> = new Map();
  private runningPipelines: Set<PipelineType> = new Set();
  private clientMap: Map<PipelineType, BasePipelineClient<unknown, TransformedRegulatorySource>>;

  constructor() {
    // Initialize pipeline statuses
    for (const schedule of PIPELINE_SCHEDULES) {
      this.statuses.set(schedule.type, {
        type: schedule.type,
        enabled: schedule.enabledByDefault,
        currentStatus: "idle",
        lastRunAt: null,
        lastSuccessAt: null,
        nextRunAt: null,
        consecutiveErrors: 0,
        lastError: null,
        lastRunResult: null,
      });
    }

    // Map pipeline types to their client instances
    this.clientMap = new Map([
      ["legiscan", legiScanClient as unknown as BasePipelineClient<unknown, TransformedRegulatorySource>],
      ["openfda", openFdaClient as unknown as BasePipelineClient<unknown, TransformedRegulatorySource>],
      ["federal_register", federalRegisterClient as unknown as BasePipelineClient<unknown, TransformedRegulatorySource>],
      ["usda", usdaClient as unknown as BasePipelineClient<unknown, TransformedRegulatorySource>],
    ]);
  }

  // ==========================================================================
  // Pipeline execution
  // ==========================================================================

  /**
   * Run a specific pipeline by type.
   * Prevents overlapping runs and tracks results.
   */
  async runPipeline(
    pipelineType: PipelineType,
    options?: { cursor?: string | null; force?: boolean }
  ): Promise<PipelineExecutionResult> {
    const schedule = this.getScheduleConfig(pipelineType);
    const status = this.getPipelineStatus(pipelineType);
    const pipelineLogger = createPipelineLogger(pipelineType);

    // Check if pipeline is enabled
    if (!status.enabled && !options?.force) {
      throw new PipelineError(
        pipelineType,
        "Pipeline is disabled. Use force=true to override.",
        { enabled: false }
      );
    }

    // Prevent overlapping runs
    if (this.runningPipelines.has(pipelineType) && !options?.force) {
      throw new PipelineError(
        pipelineType,
        "Pipeline is already running",
        { currentStatus: status.currentStatus }
      );
    }

    // Check minimum interval between runs
    if (status.lastRunAt && !options?.force) {
      const elapsed = Date.now() - status.lastRunAt.getTime();
      const minIntervalMs = schedule.minIntervalMinutes * 60 * 1000;
      if (elapsed < minIntervalMs) {
        const remainingMinutes = Math.ceil((minIntervalMs - elapsed) / 60000);
        throw new PipelineError(
          pipelineType,
          `Pipeline was run recently. Wait ${remainingMinutes} minutes or use force=true.`,
          { lastRunAt: status.lastRunAt, remainingMinutes }
        );
      }
    }

    // Execute the pipeline
    this.runningPipelines.add(pipelineType);
    status.currentStatus = "running";

    pipelineLogger.info("Pipeline execution starting");

    try {
      const client = this.clientMap.get(pipelineType);
      if (!client) {
        throw new PipelineError(pipelineType, "No client registered for pipeline type");
      }

      const result = await client.execute(options?.cursor ?? null);

      // Update status on success
      status.lastRunAt = new Date();
      status.lastRunResult = result;

      if (result.status === "completed") {
        status.lastSuccessAt = new Date();
        status.consecutiveErrors = 0;
        status.lastError = null;
        status.currentStatus = "idle";
      } else {
        status.consecutiveErrors++;
        status.lastError = result.errors.length > 0
          ? result.errors[0]!.error
          : "Pipeline completed with failures";
        status.currentStatus = "error";

        // Auto-disable after too many consecutive errors
        if (status.consecutiveErrors >= schedule.maxConsecutiveErrors) {
          status.enabled = false;
          pipelineLogger.error(
            { consecutiveErrors: status.consecutiveErrors, maxErrors: schedule.maxConsecutiveErrors },
            "Pipeline auto-disabled due to consecutive errors"
          );
        }
      }

      // Schedule next run
      status.nextRunAt = new Date(
        Date.now() + schedule.minIntervalMinutes * 60 * 1000
      );

      pipelineLogger.info(
        {
          status: result.status,
          durationMs: result.durationMs,
          created: result.created,
          updated: result.updated,
          failed: result.failed,
          consecutiveErrors: status.consecutiveErrors,
        },
        "Pipeline execution completed"
      );

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);

      status.lastRunAt = new Date();
      status.consecutiveErrors++;
      status.lastError = errMsg;
      status.currentStatus = "error";

      // Auto-disable after too many consecutive errors
      if (status.consecutiveErrors >= schedule.maxConsecutiveErrors) {
        status.enabled = false;
        pipelineLogger.error(
          { consecutiveErrors: status.consecutiveErrors, errMsg },
          "Pipeline auto-disabled due to consecutive errors"
        );
      }

      throw error;
    } finally {
      this.runningPipelines.delete(pipelineType);
    }
  }

  /**
   * Run all enabled pipelines in priority order.
   * Respects dependencies between pipelines.
   */
  async runAllPipelines(options?: { force?: boolean }): Promise<
    Map<PipelineType, PipelineExecutionResult | Error>
  > {
    const results = new Map<PipelineType, PipelineExecutionResult | Error>();
    const pipelineLogger = createPipelineLogger("legiscan"); // Use base logger

    // Sort by priority
    const sortedSchedules = [...PIPELINE_SCHEDULES].sort(
      (a, b) => a.priority - b.priority
    );

    for (const schedule of sortedSchedules) {
      const status = this.getPipelineStatus(schedule.type);

      // Skip disabled pipelines (unless forced)
      if (!status.enabled && !options?.force) {
        pipelineLogger.info(
          { pipeline: schedule.type },
          "Skipping disabled pipeline"
        );
        continue;
      }

      // Skip if already running
      if (this.runningPipelines.has(schedule.type)) {
        pipelineLogger.info(
          { pipeline: schedule.type },
          "Skipping already-running pipeline"
        );
        continue;
      }

      // Check dependencies
      const depsComplete = schedule.dependsOn.every((dep) => {
        const depResult = results.get(dep);
        return depResult && !(depResult instanceof Error);
      });

      if (schedule.dependsOn.length > 0 && !depsComplete) {
        pipelineLogger.warn(
          { pipeline: schedule.type, dependsOn: schedule.dependsOn },
          "Skipping pipeline — dependencies not met"
        );
        continue;
      }

      // Run the pipeline
      try {
        pipelineLogger.info({ pipeline: schedule.type }, "Running pipeline");
        const result = await this.runPipeline(schedule.type, {
          force: options?.force,
        });
        results.set(schedule.type, result);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        results.set(schedule.type, err);

        pipelineLogger.error(
          { pipeline: schedule.type, error: err.message },
          "Pipeline failed"
        );

        // Continue with other pipelines even if one fails
      }
    }

    return results;
  }

  // ==========================================================================
  // Enhanced execution methods
  // ==========================================================================

  /**
   * Run the LegiScan full pipeline (search → detail → text).
   * This is more comprehensive than the standard execute() method.
   */
  async runLegiScanFullPipeline(): Promise<ReturnType<typeof legiScanClient.executeFullPipeline>> {
    const pipelineLogger = createPipelineLogger("legiscan");
    const status = this.getPipelineStatus("legiscan");

    if (this.runningPipelines.has("legiscan")) {
      throw new PipelineError("legiscan", "LegiScan pipeline is already running");
    }

    this.runningPipelines.add("legiscan");
    status.currentStatus = "running";

    try {
      const result = await legiScanClient.executeFullPipeline();

      status.lastRunAt = new Date();
      status.lastSuccessAt = new Date();
      status.consecutiveErrors = 0;
      status.lastError = null;
      status.currentStatus = "idle";

      // Create a PipelineRun record
      await prisma.pipelineRun.create({
        data: {
          pipelineType: "legiscan",
          status: "completed",
          recordsProcessed: result.searchResults,
          recordsNew: result.created,
          recordsUpdated: result.updated,
          recordsFailed: result.errors.length,
          startedAt: new Date(Date.now() - 0),
          completedAt: new Date(),
        },
      });

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      status.consecutiveErrors++;
      status.lastError = errMsg;
      status.currentStatus = "error";

      throw error;
    } finally {
      this.runningPipelines.delete("legiscan");
    }
  }

  /**
   * Run the openFDA full pipeline.
   */
  async runOpenFdaFullPipeline(sinceDate?: string): Promise<ReturnType<typeof openFdaClient.executeFullPipeline>> {
    const status = this.getPipelineStatus("openfda");

    if (this.runningPipelines.has("openfda")) {
      throw new PipelineError("openfda", "openFDA pipeline is already running");
    }

    this.runningPipelines.add("openfda");
    status.currentStatus = "running";

    try {
      const result = await openFdaClient.executeFullPipeline(sinceDate);

      status.lastRunAt = new Date();
      status.lastSuccessAt = new Date();
      status.consecutiveErrors = 0;
      status.lastError = null;
      status.currentStatus = "idle";

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      status.consecutiveErrors++;
      status.lastError = errMsg;
      status.currentStatus = "error";

      throw error;
    } finally {
      this.runningPipelines.delete("openfda");
    }
  }

  /**
   * Run the Federal Register full pipeline.
   */
  async runFederalRegisterFullPipeline(sinceDate?: string): Promise<ReturnType<typeof federalRegisterClient.executeFullPipeline>> {
    const status = this.getPipelineStatus("federal_register");

    if (this.runningPipelines.has("federal_register")) {
      throw new PipelineError("federal_register", "Federal Register pipeline is already running");
    }

    this.runningPipelines.add("federal_register");
    status.currentStatus = "running";

    try {
      const result = await federalRegisterClient.executeFullPipeline(sinceDate);

      status.lastRunAt = new Date();
      status.lastSuccessAt = new Date();
      status.consecutiveErrors = 0;
      status.lastError = null;
      status.currentStatus = "idle";

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      status.consecutiveErrors++;
      status.lastError = errMsg;
      status.currentStatus = "error";

      throw error;
    } finally {
      this.runningPipelines.delete("federal_register");
    }
  }

  /**
   * Run the USDA full pipeline.
   */
  async runUsdaFullPipeline(): Promise<ReturnType<typeof usdaClient.executeFullPipeline>> {
    const status = this.getPipelineStatus("usda");

    if (this.runningPipelines.has("usda")) {
      throw new PipelineError("usda", "USDA pipeline is already running");
    }

    this.runningPipelines.add("usda");
    status.currentStatus = "running";

    try {
      const result = await usdaClient.executeFullPipeline();

      status.lastRunAt = new Date();
      status.lastSuccessAt = new Date();
      status.consecutiveErrors = 0;
      status.lastError = null;
      status.currentStatus = "idle";

      return result;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      status.consecutiveErrors++;
      status.lastError = errMsg;
      status.currentStatus = "error";

      throw error;
    } finally {
      this.runningPipelines.delete("usda");
    }
  }

  // ==========================================================================
  // Health check
  // ==========================================================================

  /**
   * Check the health of all pipelines by testing their API connectivity.
   */
  async healthCheckAll(): Promise<Map<PipelineType, boolean>> {
    const results = new Map<PipelineType, boolean>();

    for (const [type, client] of this.clientMap) {
      try {
        const isHealthy = await client.healthCheck();
        results.set(type, isHealthy);
      } catch {
        results.set(type, false);
      }
    }

    return results;
  }

  /**
   * Check the health of a specific pipeline.
   */
  async healthCheck(pipelineType: PipelineType): Promise<boolean> {
    const client = this.clientMap.get(pipelineType);
    if (!client) return false;

    try {
      return await client.healthCheck();
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // Status and monitoring
  // ==========================================================================

  /**
   * Get the current status of all pipelines.
   */
  getAllStatuses(): PipelineStatus[] {
    return Array.from(this.statuses.values());
  }

  /**
   * Get the status of a specific pipeline.
   */
  getPipelineStatus(pipelineType: PipelineType): PipelineStatus {
    const status = this.statuses.get(pipelineType);
    if (!status) {
      throw new PipelineError(pipelineType, "Unknown pipeline type");
    }
    return status;
  }

  /**
   * Enable a pipeline that was auto-disabled.
   */
  enablePipeline(pipelineType: PipelineType): void {
    const status = this.getPipelineStatus(pipelineType);
    status.enabled = true;
    status.consecutiveErrors = 0;
    status.lastError = null;

    const pipelineLogger = createPipelineLogger(pipelineType);
    pipelineLogger.info("Pipeline re-enabled");
  }

  /**
   * Disable a pipeline manually.
   */
  disablePipeline(pipelineType: PipelineType): void {
    const status = this.getPipelineStatus(pipelineType);
    status.enabled = false;

    const pipelineLogger = createPipelineLogger(pipelineType);
    pipelineLogger.info("Pipeline disabled");
  }

  /**
   * Get the run history for a specific pipeline from the database.
   */
  async getRunHistory(
    pipelineType: PipelineType,
    limit: number = 20
  ): Promise<
    Array<{
      id: string;
      status: string;
      recordsProcessed: number;
      recordsNew: number;
      recordsUpdated: number;
      recordsFailed: number;
      errorDetail: string | null;
      startedAt: Date;
      completedAt: Date | null;
      duration: number | null;
    }>
  > {
    return prisma.pipelineRun.findMany({
      where: { pipelineType },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  /**
   * Get the overall pipeline summary.
   * Aggregates status across all pipelines for dashboard display.
   */
  getSummary(): {
    totalPipelines: number;
    enabledPipelines: number;
    runningPipelines: number;
    errorPipelines: number;
    lastSuccessfulRun: Date | null;
    pipelineDetails: Array<{
      type: PipelineType;
      enabled: boolean;
      status: string;
      lastRunAt: Date | null;
      consecutiveErrors: number;
      nextRunAt: Date | null;
    }>;
  } {
    const statuses = this.getAllStatuses();
    const enabledPipelines = statuses.filter((s) => s.enabled);
    const runningPipelines = statuses.filter((s) => s.currentStatus === "running");
    const errorPipelines = statuses.filter((s) => s.consecutiveErrors > 0);

    const lastSuccessfulRuns = statuses
      .map((s) => s.lastSuccessAt)
      .filter((d): d is Date => d !== null);
    const lastSuccessfulRun = lastSuccessfulRuns.length > 0
      ? new Date(Math.max(...lastSuccessfulRuns.map((d) => d.getTime())))
      : null;

    return {
      totalPipelines: statuses.length,
      enabledPipelines: enabledPipelines.length,
      runningPipelines: runningPipelines.length,
      errorPipelines: errorPipelines.length,
      lastSuccessfulRun,
      pipelineDetails: statuses.map((s) => ({
        type: s.type,
        enabled: s.enabled,
        status: s.currentStatus,
        lastRunAt: s.lastRunAt,
        consecutiveErrors: s.consecutiveErrors,
        nextRunAt: s.nextRunAt,
      })),
    };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private getScheduleConfig(pipelineType: PipelineType): PipelineScheduleConfig {
    const config = PIPELINE_SCHEDULES.find((s) => s.type === pipelineType);
    if (!config) {
      throw new PipelineError(pipelineType, "No schedule configuration found");
    }
    return config;
  }
}

// ============================================================================
// Singleton export
// ============================================================================
export const pipelineOrchestrator = new PipelineOrchestrator();
