// Cascada — Pipeline Type API Route
// GET /api/pipelines/[type] — Get status of a specific pipeline
// POST /api/pipelines/[type] — Trigger a specific pipeline run
// PATCH /api/pipelines/[type] — Enable/disable a pipeline

import { NextRequest, NextResponse } from "next/server";
import { pipelineOrchestrator } from "@/lib/pipelines/orchestrator";
import { AuthenticationError, AuthorizationError, PipelineError } from "@/lib/errors";
import type { PipelineType } from "@/lib/pipelines/types";
import { PIPELINE_TYPES } from "@/lib/pipelines/types";

// ============================================================================
// Route context type
// ============================================================================
interface RouteContext {
  params: Promise<{ type: string }>;
}

// ============================================================================
// GET /api/pipelines/[type] — Get specific pipeline status
// ============================================================================
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { type } = await context.params;
    const pipelineType = validatePipelineType(type);

    const status = pipelineOrchestrator.getPipelineStatus(pipelineType);

    return NextResponse.json({
      data: {
        type: status.type,
        enabled: status.enabled,
        currentStatus: status.currentStatus,
        lastRunAt: status.lastRunAt?.toISOString() ?? null,
        lastSuccessAt: status.lastSuccessAt?.toISOString() ?? null,
        nextRunAt: status.nextRunAt?.toISOString() ?? null,
        consecutiveErrors: status.consecutiveErrors,
        lastError: status.lastError,
        lastRunResult: status.lastRunResult
          ? {
              pipelineType: status.lastRunResult.pipelineType,
              status: status.lastRunResult.status,
              durationMs: status.lastRunResult.durationMs,
              fetched: status.lastRunResult.fetched,
              created: status.lastRunResult.created,
              updated: status.lastRunResult.updated,
              failed: status.lastRunResult.failed,
              skipped: status.lastRunResult.skipped,
              duplicates: status.lastRunResult.duplicates,
            }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/pipelines/[type] — Trigger a specific pipeline run
// ============================================================================
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    // TODO: Add auth check — only TENANT_ADMIN and COMPLIANCE can trigger
    const { type } = await context.params;
    const pipelineType = validatePipelineType(type);

    const body = await request.json() as {
      force?: boolean;
      cursor?: string;
      mode?: "standard" | "full";
      sinceDate?: string;
    };

    const force = body.force ?? false;

    // Determine execution mode
    if (body.mode === "full") {
      // Use the enhanced full pipeline methods
      let result: unknown;
      switch (pipelineType) {
        case "legiscan":
          result = await pipelineOrchestrator.runLegiScanFullPipeline();
          break;
        case "openfda":
          result = await pipelineOrchestrator.runOpenFdaFullPipeline(body.sinceDate);
          break;
        case "federal_register":
          result = await pipelineOrchestrator.runFederalRegisterFullPipeline(body.sinceDate);
          break;
        case "usda":
          result = await pipelineOrchestrator.runUsdaFullPipeline();
          break;
      }

      return NextResponse.json({ data: result });
    }

    // Standard execution
    const result = await pipelineOrchestrator.runPipeline(pipelineType, {
      force,
      cursor: body.cursor ?? null,
    });

    return NextResponse.json({
      data: {
        pipelineType: result.pipelineType,
        status: result.status,
        durationMs: result.durationMs,
        fetched: result.fetched,
        created: result.created,
        updated: result.updated,
        failed: result.failed,
        skipped: result.skipped,
        duplicates: result.duplicates,
        errors: result.errors,
      },
    });
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, context: error.context } },
        { status: error.statusCode }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

// ============================================================================
// PATCH /api/pipelines/[type] — Enable/disable a pipeline
// ============================================================================
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    // TODO: Add auth check — only TENANT_ADMIN can enable/disable
    const { type } = await context.params;
    const pipelineType = validatePipelineType(type);

    const body = await request.json() as {
      enabled?: boolean;
    };

    if (body.enabled === undefined) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "Must specify 'enabled' field" } },
        { status: 400 }
      );
    }

    if (body.enabled) {
      pipelineOrchestrator.enablePipeline(pipelineType);
    } else {
      pipelineOrchestrator.disablePipeline(pipelineType);
    }

    const status = pipelineOrchestrator.getPipelineStatus(pipelineType);

    return NextResponse.json({
      data: {
        type: status.type,
        enabled: status.enabled,
        currentStatus: status.currentStatus,
      },
    });
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

// ============================================================================
// Health check endpoint
// ============================================================================
export async function PUT(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { type } = await context.params;
    const pipelineType = validatePipelineType(type);

    const isHealthy = await pipelineOrchestrator.healthCheck(pipelineType);

    return NextResponse.json({
      data: {
        type: pipelineType,
        healthy: isHealthy,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof PipelineError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================
function validatePipelineType(type: string): PipelineType {
  if (!PIPELINE_TYPES.includes(type as PipelineType)) {
    throw new PipelineError(type, `Invalid pipeline type: ${type}`, {
      validTypes: PIPELINE_TYPES,
    });
  }
  return type as PipelineType;
}
