// Cascada - single pipeline status, bounded execution, and admin mutation API.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { requirePipelineAccess } from "@/lib/api/pipeline-auth";
import { AuthenticationError, AuthorizationError, PipelineError } from "@/lib/errors";
import { pipelineOrchestrator } from "@/lib/pipelines/orchestrator";
import {
  DEFAULT_PIPELINE_RUN_LIMIT,
  MAX_PIPELINE_RUN_LIMIT,
  PIPELINE_TYPES,
  type PipelineExecutionMode,
  type PipelineType,
} from "@/lib/pipelines/types";

interface RouteContext {
  params: Promise<{ type: string }>;
}

const pipelineRunSchema = z
  .object({
    mode: z.enum(["dry_run", "write"]).default("dry_run"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PIPELINE_RUN_LIMIT)
      .default(DEFAULT_PIPELINE_RUN_LIMIT),
    cursor: z.string().nullable().optional(),
    approvedSourceIds: z.array(z.string().trim().min(1)).max(MAX_PIPELINE_RUN_LIMIT).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === "write" && (!value.approvedSourceIds || value.approvedSourceIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedSourceIds"],
        message: "Write mode requires approvedSourceIds",
      });
    }
  });

const pipelinePatchSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requirePipelineAccess("COMPLIANCE");
    const pipelineType = await pipelineTypeFromContext(context);
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
    return pipelineErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    await requirePipelineAccess("COMPLIANCE");
    const pipelineType = await pipelineTypeFromContext(context);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const validated = pipelineRunSchema.parse(body);
    const mode = validated.mode as PipelineExecutionMode;

    const result = await pipelineOrchestrator.runPipelineBounded(pipelineType, {
      mode,
      limit: validated.limit,
      cursor: validated.cursor ?? null,
      approvedSourceIds: validated.approvedSourceIds,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    return pipelineErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    await requirePipelineAccess("TENANT_ADMIN");
    const pipelineType = await pipelineTypeFromContext(context);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const validated = pipelinePatchSchema.parse(body);

    if (validated.enabled) {
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
    return pipelineErrorResponse(error);
  }
}

export async function PUT(_request: NextRequest, context: RouteContext) {
  try {
    await requirePipelineAccess("COMPLIANCE");
    const pipelineType = await pipelineTypeFromContext(context);
    const isHealthy = await pipelineOrchestrator.healthCheck(pipelineType);

    return NextResponse.json({
      data: {
        type: pipelineType,
        healthy: isHealthy,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return pipelineErrorResponse(error);
  }
}

async function pipelineTypeFromContext(context: RouteContext): Promise<PipelineType> {
  const { type } = await context.params;
  if (!PIPELINE_TYPES.includes(type as PipelineType)) {
    throw new PipelineError(type, `Invalid pipeline type: ${type}`, {
      validTypes: PIPELINE_TYPES,
    });
  }
  return type as PipelineType;
}

function pipelineErrorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Invalid pipeline request",
          issues: error.issues,
          validTypes: PIPELINE_TYPES,
          maxLimit: MAX_PIPELINE_RUN_LIMIT,
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 401 });
  }

  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 403 });
  }

  if (error instanceof PipelineError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, context: error.context } },
      { status: error.statusCode },
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message } }, { status: 500 });
}
