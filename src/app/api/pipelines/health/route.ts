// Cascada — Pipeline Health Check API Route
// GET /api/pipelines/health — Check connectivity to all external data sources

import { NextResponse } from "next/server";
import { pipelineOrchestrator } from "@/lib/pipelines/orchestrator";
import { requirePipelineAccess } from "@/lib/api/pipeline-auth";
import { AuthenticationError, AuthorizationError } from "@/lib/errors";

// ============================================================================
// GET /api/pipelines/health — Health check all pipeline connections
// ============================================================================
export async function GET() {
  try {
    await requirePipelineAccess("COMPLIANCE");
    const healthResults = await pipelineOrchestrator.healthCheckAll();

    const pipelines: Record<string, { healthy: boolean; checkedAt: string }> = {};
    let allHealthy = true;

    for (const [type, healthy] of healthResults) {
      pipelines[type] = {
        healthy,
        checkedAt: new Date().toISOString(),
      };
      if (!healthy) allHealthy = false;
    }

    return NextResponse.json({
      data: {
        status: allHealthy ? "healthy" : "degraded",
        pipelines,
        checkedAt: new Date().toISOString(),
      },
    }, { status: allHealthy ? 200 : 503 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 401 },
      );
    }

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: 403 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}
