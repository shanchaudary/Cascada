// Cascada — Pipeline Run History API Route
// GET /api/pipelines/[type]/history — Get run history for a pipeline

import { NextRequest, NextResponse } from "next/server";
import { pipelineOrchestrator } from "@/lib/pipelines/orchestrator";
import { PipelineError } from "@/lib/errors";
import type { PipelineType } from "@/lib/pipelines/types";
import { PIPELINE_TYPES } from "@/lib/pipelines/types";

// ============================================================================
// Route context type
// ============================================================================
interface RouteContext {
  params: Promise<{ type: string }>;
}

// ============================================================================
// GET /api/pipelines/[type]/history — Get pipeline run history
// ============================================================================
export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { type } = await context.params;

    // Validate pipeline type
    if (!PIPELINE_TYPES.includes(type as PipelineType)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: `Invalid pipeline type: ${type}`,
            validTypes: PIPELINE_TYPES,
          },
        },
        { status: 400 }
      );
    }

    const pipelineType = type as PipelineType;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "20", 10), 1),
      100
    );

    const runs = await pipelineOrchestrator.getRunHistory(pipelineType, limit);

    return NextResponse.json({
      data: runs.map((run) => ({
        id: run.id,
        pipelineType,
        status: run.status,
        recordsProcessed: run.recordsProcessed,
        recordsNew: run.recordsNew,
        recordsUpdated: run.recordsUpdated,
        recordsFailed: run.recordsFailed,
        errorDetail: run.errorDetail,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        durationMs: run.duration,
      })),
      meta: {
        pipelineType,
        count: runs.length,
        limit,
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
