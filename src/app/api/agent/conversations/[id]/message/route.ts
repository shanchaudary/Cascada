// Cascada — POST /api/agent/conversations/:id/message
// Send a message in an existing conversation.
// Supports multi-turn conversations with context from previous messages.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { agentConversationMessageSchema } from "@/lib/validation";
import { executeExecutiveQueryAgent } from "@/lib/agent/executive-query";
import { AgentPlanAccessError, AgentBudgetError } from "@/lib/errors";
import { AGENT_CONFIG } from "@/lib/agent/types";
import type { AgentExecutionContext } from "@/lib/agent/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params;
    const body = await request.json();
    const parseResult = agentConversationMessageSchema.safeParse(body);

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

    const { content, contextFilters } = parseResult.data;

    const tenantId = request.headers.get("x-tenant-id");
    const userId = request.headers.get("x-user-id") ?? "unknown";

    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID required (x-tenant-id header)" },
        { status: 400 }
      );
    }

    // Verify the conversation exists and belongs to this tenant
    const instance = await prisma.workflowInstance.findFirst({
      where: { id: conversationId, tenantId },
    });

    if (!instance) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (instance.status === "COMPLETED" || instance.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Conversation is closed. Start a new conversation." },
        { status: 400 }
      );
    }

    // Get tenant plan
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
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
        { error: "Query Agent requires Pro or Command plan" },
        { status: 403 }
      );
    }

    // Build execution context
    const executionContext: AgentExecutionContext = {
      tenantId,
      userId,
      agentType: "executive_query",
      conversationId,
      plan: tenant.plan,
      enableTools: true,
      traceId: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };

    // Execute the agent with the conversation context
    const result = await executeExecutiveQueryAgent(
      {
        query: content,
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

    // Update the workflow instance with the new step
    const currentSteps = (instance.steps as Array<Record<string, unknown>>) ?? [];
    const updatedSteps = [
      ...currentSteps,
      {
        id: `step_${currentSteps.length + 1}`,
        name: "User Message",
        description: content,
        type: "user_input",
        status: "completed",
      },
      {
        id: `step_${currentSteps.length + 2}`,
        name: "Agent Response",
        description: result.content.slice(0, 1000),
        type: "agent_response",
        status: "completed",
      },
    ];

    await prisma.workflowInstance.update({
      where: { id: conversationId },
      data: {
        steps: JSON.parse(JSON.stringify(updatedSteps)),
        status: "RUNNING",
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({
      content: result.content,
      conversationId,
      intent: result.detectedIntent,
      topics: result.topics,
      followUpQuestions: result.followUpQuestions,
      usage: result.usage,
      model: result.model,
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    if (error instanceof AgentPlanAccessError || error instanceof AgentBudgetError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to process message", details: errorMessage },
      { status: 500 }
    );
  }
}
