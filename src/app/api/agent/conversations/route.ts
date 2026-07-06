// Cascada — GET /api/agent/conversations
// List conversations for the current tenant and user.
// Returns active and recently closed conversations.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { paginationSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID required (x-tenant-id header)" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const pagination = paginationSchema.parse({
      page: searchParams.get("page") ?? "1",
      limit: searchParams.get("limit") ?? "20",
    });

    const agentType = searchParams.get("agentType") ?? undefined;
    const status = searchParams.get("status") ?? "active";

    // Query workflow instances of type "agent_conversation" as our conversation store
    // In production, this would be a dedicated conversations table (Stage 8)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      tenantId,
      workflowType: agentType ?? { contains: "agent_" },
    };

    if (status === "active") {
      where.status = { in: ["PENDING", "RUNNING"] };
    }

    const [instances, total] = await Promise.all([
      prisma.workflowInstance.findMany({
        where,
        select: {
          id: true,
          workflowType: true,
          status: true,
          currentStep: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        orderBy: { updatedAt: "desc" },
      }),
      prisma.workflowInstance.count({ where }),
    ]);

    // Map to conversation-like response
    const conversations = instances.map((inst) => ({
      id: inst.id,
      agentType: inst.workflowType.replace("agent_", ""),
      status: inst.status === "RUNNING" ? "active" : inst.status === "COMPLETED" ? "closed" : "active",
      title: inst.currentStep ?? "Conversation",
      createdAt: inst.createdAt.toISOString(),
      updatedAt: inst.updatedAt.toISOString(),
      closedAt: inst.completedAt?.toISOString() ?? null,
    }));

    return NextResponse.json({
      conversations,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to list conversations", details: errorMessage },
      { status: 500 }
    );
  }
}
