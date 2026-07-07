// Cascada - platform data-source secret status.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthorizationError, AuthenticationError } from "@/lib/errors";
import { pipelineOrchestrator } from "@/lib/pipelines/orchestrator";
import { PIPELINE_TYPES, type PipelineType } from "@/lib/pipelines/types";

interface DataSourceDefinition {
  type: PipelineType;
  label: string;
  envVar: string;
  required: boolean;
}

const DATA_SOURCES: DataSourceDefinition[] = [
  { type: "legiscan", label: "LegiScan", envVar: "LEGISCAN_API_KEY", required: true },
  { type: "openfda", label: "openFDA", envVar: "OPENFDA_API_KEY", required: false },
  {
    type: "federal_register",
    label: "Federal Register",
    envVar: "FEDERAL_REGISTER_API_KEY",
    required: false,
  },
  { type: "usda", label: "USDA FoodData Central", envVar: "USDA_API_KEY", required: false },
];

function isConfigured(envVar: string): boolean {
  return Boolean(process.env[envVar]?.trim());
}

function validatePipelineType(value: unknown): PipelineType | null {
  return typeof value === "string" && PIPELINE_TYPES.includes(value as PipelineType)
    ? value as PipelineType
    : null;
}

async function requirePlatformAdmin() {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Authentication required");
  }

  const role = (session.user as Record<string, unknown>)["role"];
  if (role !== "TENANT_ADMIN" && role !== "SUPER_ADMIN") {
    throw new AuthorizationError("Admin access required");
  }
}

async function lastSuccessfulSyncAt(type: PipelineType): Promise<string | null> {
  const run = await prisma.pipelineRun.findFirst({
    where: { pipelineType: type, status: "completed" },
    orderBy: { completedAt: "desc" },
    select: { completedAt: true },
  });

  return run?.completedAt?.toISOString() ?? null;
}

async function lastError(type: PipelineType): Promise<string | null> {
  const run = await prisma.pipelineRun.findFirst({
    where: { pipelineType: type, status: "failed" },
    orderBy: { startedAt: "desc" },
    select: { errorDetail: true },
  });

  return run?.errorDetail ?? null;
}

export async function GET() {
  try {
    await requirePlatformAdmin();

    const dataSources = await Promise.all(
      DATA_SOURCES.map(async (source) => ({
        type: source.type,
        label: source.label,
        envVar: source.envVar,
        required: source.required,
        configured: isConfigured(source.envVar),
        maskedValue: isConfigured(source.envVar) ? "Configured" : "Missing",
        lastSuccessfulSyncAt: await lastSuccessfulSyncAt(source.type),
        lastError: await lastError(source.type),
      })),
    );

    return NextResponse.json({ dataSources });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: error.message } },
        { status: 401 },
      );
    }

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: error.message } },
        { status: 403 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requirePlatformAdmin();

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const type = validatePipelineType(body["type"]);
    const source = DATA_SOURCES.find((item) => item.type === type);

    if (!type || !source) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "Invalid data source type" } },
        { status: 400 },
      );
    }

    if (!isConfigured(source.envVar)) {
      return NextResponse.json({
        type,
        healthy: false,
        checkedAt: new Date().toISOString(),
        message: `${source.envVar} is not configured`,
      });
    }

    const healthy = await pipelineOrchestrator.healthCheck(type);
    return NextResponse.json({
      type,
      healthy,
      checkedAt: new Date().toISOString(),
      message: healthy ? "Connection test passed" : "Connection test failed",
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: error.message } },
        { status: 401 },
      );
    }

    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: error.message } },
        { status: 403 },
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 },
    );
  }
}
