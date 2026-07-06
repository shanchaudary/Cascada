// Cascada — Pipeline Status API Route
// GET /api/pipelines — Get status of all pipelines
// POST /api/pipelines — Trigger a pipeline run

import { NextRequest, NextResponse } from "next/server";
import { pipelineOrchestrator } from "@/lib/pipelines/orchestrator";
import { AuthenticationError, AuthorizationError, PipelineError } from "@/lib/errors";
import type { PipelineType } from "@/lib/pipelines/types";
import { PIPELINE_TYPES } from "@/lib/pipelines/types";

// ============================================================================
// GET /api/pipelines — Get pipeline status summary
// ============================================================================
export async function GET(_request: NextRequest) {
  try {
    // TODO: Add auth check when Stage 8 implements full API auth
    // const session = await getServerSession(authOptions);
    // if (!session) throw new AuthenticationError();

    const summary = pipelineOrchestrator.getSummary();

    return NextResponse.json({
      data: {
        totalPipelines: summary.totalPipelines,
        enabledPipelines: summary.enabledPipelines,
        runningPipelines: summary.runningPipelines,
        errorPipelines: summary.errorPipelines,
        lastSuccessfulRun: summary.lastSuccessfulRun?.toISOString() ?? null,
        pipelines: summary.pipelineDetails.map((p) => ({
          type: p.type,
          enabled: p.enabled,
          status: p.status,
          lastRunAt: p.lastRunAt?.toISOString() ?? null,
          consecutiveErrors: p.consecutiveErrors,
          nextRunAt: p.nextRunAt?.toISOString() ?? null,
        })),
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: error.message } }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: error.message } }, { status: 403 });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

// ============================================================================
// POST /api/pipelines — Trigger a pipeline run
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    // TODO: Add auth check — only TENANT_ADMIN and COMPLIANCE can trigger pipelines
    // const session = await getServerSession(authOptions);
    // if (!session) throw new AuthenticationError();
    // if (!["TENANT_ADMIN", "COMPLIANCE"].includes(session.user.role)) {
    //   throw new AuthorizationError("Only admins can trigger pipeline runs");
    // }

    const body = await request.json() as {
      pipelineType?: string;
      force?: boolean;
      cursor?: string;
    };

    // Validate pipeline type
    const pipelineType = body.pipelineType as PipelineType | undefined;

    if (pipelineType && !PIPELINE_TYPES.includes(pipelineType)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: `Invalid pipeline type: ${pipelineType}`,
            validTypes: PIPELINE_TYPES,
          },
        },
        { status: 400 }
      );
    }

    // Run a specific pipeline or all pipelines
    if (pipelineType) {
      const result = await pipelineOrchestrator.runPipeline(pipelineType, {
        force: body.force ?? false,
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
    }

    // Run all pipelines
    const results = await pipelineOrchestrator.runAllPipelines({
      force: body.force ?? false,
    });

    const response: Record<string, unknown> = {};
    for (const [type, result] of results) {
      if (result instanceof Error) {
        response[type] = {
          pipelineType: type,
          status: "failed",
          error: result.message,
        };
      } else {
        response[type] = {
          pipelineType: result.pipelineType,
          status: result.status,
          durationMs: result.durationMs,
          fetched: result.fetched,
          created: result.created,
          updated: result.updated,
          failed: result.failed,
          skipped: result.skipped,
          duplicates: result.duplicates,
        };
      }
    }

    return NextResponse.json({ data: response });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: error.message } }, { status: 401 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: error.message } }, { status: 403 });
    }
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
