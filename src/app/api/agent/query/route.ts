// Cascada — POST /api/agent/query
// Executive Query Agent endpoint. PRO and COMMAND plans only.
// Accepts a query from a C-suite user and returns a business-focused answer
// with RAG context from the tenant's cascade graph.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { AgentPlanAccessError, AgentBudgetError } from "@/lib/errors";
import { agentQuerySchema } from "@/lib/validation";
import { executeExecutiveQueryAgent } from "@/lib/agent/executive-query";
import { AGENT_CONFIG } from "@/lib/agent/types";
import type { AgentExecutionContext } from "@/lib/agent/types";

export async function POST(request: NextRequest) {
  try {
    // Parse and validate input
    const body = await request.json();
    const parseResult = agentQuerySchema.safeParse(body);

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

    const { query, conversationId, contextFilters } = parseResult.data;

    // TODO: Get tenant and user from auth session (Stage 8 full impl)
    // For now, require tenantId and userId in headers for development
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
    if (!AGENT_CONFIG.AGENT_PLAN_ACCESS[tenant.plan].includes("executive_query")) {
      return NextResponse.json(
        {
          error: "Executive Query Agent requires Pro or Command plan",
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
      agentType: "executive_query",
      conversationId: conversationId ?? `conv_${Date.now()}`,
      plan: tenant.plan,
      enableTools: true,
      traceId: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    // Execute the agent
    const result = await executeExecutiveQueryAgent(
      {
        query,
        conversationId,
        contextOverride: contextFilters
          ? {
              focusJurisdictions: contextFilters.jurisdiction,
              focusProducts: contextFilters.productCategory,
            }
          : undefined,
      },
      executionContext
    );

    return NextResponse.json({
      content: result.content,
      conversationId: executionContext.conversationId,
      intent: result.detectedIntent,
      topics: result.topics,
      followUpQuestions: result.followUpQuestions,
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
      { error: "Agent execution failed", details: errorMessage },
      { status: 500 }
    );
  }
}
