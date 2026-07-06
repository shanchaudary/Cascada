// Cascada — GET /api/agent/conversations/:id
// GET: Retrieve a specific conversation with its message history
// DELETE: Close/archive a conversation

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = request.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID required (x-tenant-id header)" },
        { status: 400 }
      );
    }

    // Look up the conversation (stored as WorkflowInstance)
    const instance = await prisma.workflowInstance.findFirst({
      where: { id, tenantId },
    });

    if (!instance) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Parse the steps field as messages
    const steps = instance.steps as Array<Record<string, unknown>> ?? [];
    const messages = steps.map((step, i) => ({
      id: `msg_${i}`,
      role: (i % 2 === 0) ? "user" as const : "assistant" as const,
      content: String(step["description"] ?? step["name"] ?? ""),
      timestamp: instance.createdAt.toISOString(),
    }));

    return NextResponse.json({
      id: instance.id,
      agentType: instance.workflowType.replace("agent_", ""),
      status: instance.status === "RUNNING" ? "active" : instance.status === "COMPLETED" ? "closed" : "active",
      title: instance.currentStep ?? "Conversation",
      messages,
      createdAt: instance.createdAt.toISOString(),
      updatedAt: instance.updatedAt.toISOString(),
      closedAt: instance.completedAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to get conversation", details: errorMessage },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tenantId = request.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID required (x-tenant-id header)" },
        { status: 400 }
      );
    }

    // Close the conversation by updating the workflow instance status
    const instance = await prisma.workflowInstance.findFirst({
      where: { id, tenantId },
    });

    if (!instance) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    await prisma.workflowInstance.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      id,
      status: "closed",
      closedAt: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to close conversation", details: errorMessage },
      { status: 500 }
    );
  }
}
