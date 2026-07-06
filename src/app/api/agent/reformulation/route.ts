// Cascada — POST /api/agent/reformulation
// Reformulation Advisor Agent endpoint. PRO and COMMAND plans only.
// Accepts an ingredient ID and returns reformulation alternatives.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AgentPlanAccessError, AgentBudgetError } from "@/lib/errors";
import { agentReformulationSchema } from "@/lib/validation";
import { executeReformulationAgent } from "@/lib/agent/reformulation";
import { AGENT_CONFIG } from "@/lib/agent/types";
import type { AgentExecutionContext } from "@/lib/agent/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parseResult = agentReformulationSchema.safeParse(body);

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

    const { ingredientId, triggerId, focusProductIds, includeAiSuggestions } = parseResult.data;

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

    // Plan access check
    if (!AGENT_CONFIG.AGENT_PLAN_ACCESS[tenant.plan].includes("reformulation")) {
      return NextResponse.json(
        {
          error: "Reformulation Advisor requires Pro or Command plan",
          requiredPlan: "PRO",
          currentPlan: tenant.plan,
        },
        { status: 403 }
      );
    }

    // Build execution context
    const executionContext: AgentExecutionContext = {
      tenantId,
      userId,
      agentType: "reformulation",
      conversationId: `reform_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      plan: tenant.plan,
      enableTools: true,
      traceId: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    // Execute the reformulation agent
    const result = await executeReformulationAgent(
      {
        ingredientId,
        triggerId,
        focusProductIds,
        includeAiSuggestions,
      },
      executionContext
    );

    return NextResponse.json({
      content: result.content,
      substitutes: result.substitutes,
      recommendation: result.recommendation,
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
      { error: "Reformulation agent execution failed", details: errorMessage },
      { status: 500 }
    );
  }
}
