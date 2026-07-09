// Cascada - pipeline status and bounded execution API.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { pipelineOrchestrator } from "@/lib/pipelines/orchestrator";
import {
  DEFAULT_PIPELINE_RUN_LIMIT,
  MAX_PIPELINE_RUN_LIMIT,
  PIPELINE_TYPES,
  type PipelineExecutionMode,
  type PipelineType,
} from "@/lib/pipelines/types";
import { AuthenticationError, AuthorizationError, PipelineError } from "@/lib/errors";
import { requirePipelineAccess } from "@/lib/api/pipeline-auth";

const pipelinePostSchema = z
  .object({
    pipelineType: z.enum(["legiscan", "openfda", "federal_register", "usda"]),
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

export async function GET() {
  try {
    await requirePipelineAccess("COMPLIANCE");

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
    return pipelineErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePipelineAccess("COMPLIANCE");

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const validated = pipelinePostSchema.parse(body);
    const pipelineType = validated.pipelineType as PipelineType;
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
