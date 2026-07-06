// Cascada — POST /api/agent/workflow
// Workflow Generator Agent endpoint. COMMAND plan only.
// Accepts a decision package ID and generates a Temporal workflow definition.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AgentPlanAccessError, AgentBudgetError } from "@/lib/errors";
import { agentWorkflowGenerateSchema } from "@/lib/validation";
import { executeWorkflowGeneratorAgent } from "@/lib/agent/workflow-generator";
import { AGENT_CONFIG } from "@/lib/agent/types";
import type { AgentExecutionContext } from "@/lib/agent/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = agentWorkflowGenerateSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: parseResult.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      );
    }

    const { decisionPackageId, decision, decisionNotes, modifications } = parseResult.data;

    const tenantId = request.headers.get("x-tenant-id");
    const userId = request.headers.get("x-user-id") ?? "unknown";

    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID required (x-tenant-id header)" },
        { status: 400 }
      );
    }

    // Get tenant plan
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, plan: true },
    });

    if (!tenant) {
      return NextResponse.json(
        { error: "Tenant not found" },
        { status: 404 }
      );
    }

    // Plan access check — COMMAND plan only
    if (tenant.plan !== "COMMAND") {
      return NextResponse.json(
        {
          error: "Workflow Generator requires Command plan",
          requiredPlan: "COMMAND",
          currentPlan: tenant.plan,
        },
        { status: 403 }
      );
    }

    // Build execution context
    const executionContext: AgentExecutionContext = {
      tenantId,
      userId,
      agentType: "workflow_generator",
      conversationId: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      plan: tenant.plan,
      enableTools: true,
      traceId: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    // Execute the workflow generator agent
    const result = await executeWorkflowGeneratorAgent(
      {
        decisionPackageId,
        decision,
        decisionNotes,
        modifications,
      },
      executionContext
    );

    return NextResponse.json({
      content: result.content,
      workflow: result.workflow,
      validation: result.validation,
      usage: result.usage,
      model: result.model,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    if (error instanceof AgentPlanAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }
    if (error instanceof AgentBudgetError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Workflow generator agent execution failed", details: errorMessage },
      { status: 500 }
    );
  }
}
