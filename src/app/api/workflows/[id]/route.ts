// Cascada — Workflow Detail API Route
// GET /api/workflows/[id] — Single workflow with step details

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import {
  AuthenticationError,
  NotFoundError,
  CascadaError,
  toError,
} from "@/lib/errors";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Extract and validate the current session + tenant context.
 */
async function getAuthenticatedContext() {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Authentication required");
  }

  const sessionUser = session.user as Record<string, unknown>;
  const userId = sessionUser["id"] as string | undefined;
  const tenantId = sessionUser["tenantId"] as string | undefined;
  const role = sessionUser["role"] as string | undefined;

  if (!userId || !tenantId || !role) {
    throw new AuthenticationError("Session is missing required claims");
  }

  return { userId, tenantId, role };
}

// GET /api/workflows/[id] — Single workflow with step details
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const workflow = await withTenant(tenantId, async () => {
      return prisma.workflowInstance.findFirst({
        where: { id, tenantId },
      });
    });

    if (!workflow) {
      throw new NotFoundError("WorkflowInstance", id);
    }

    // Parse the steps JSON and enrich with assignee details
    const steps = workflow.steps as Record<string, unknown>[];

    // Resolve assignee details for each step
    const assigneeIds = steps
      .map((step) => step["assignee"] as string | null)
      .filter((assignee): assignee is string => assignee !== null);

    const uniqueAssigneeIds = [...new Set(assigneeIds)];

    const assigneeDetails = uniqueAssigneeIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: uniqueAssigneeIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];

    const assigneeMap = new Map(assigneeDetails.map((u) => [u.id, u]));

    // Resolve assignedTo user details
    const assignedToUsers = await prisma.user.findMany({
      where: { id: { in: workflow.assignedTo } },
      select: { id: true, name: true, email: true, role: true },
    });

    // Compute step progress
    const totalSteps = steps.length;
    const completedSteps = steps.filter((s) => s["status"] === "completed").length;
    const inProgressSteps = steps.filter((s) => s["status"] === "in_progress").length;
    const pendingSteps = steps.filter((s) => s["status"] === "pending").length;
    const progressPercentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    // Compute elapsed and remaining time
    const now = new Date();
    const startedAtDate = workflow.startedAt;
    let elapsedDays = 0;
    if (startedAtDate) {
      elapsedDays = Math.floor((now.getTime() - startedAtDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    // Resolve decision package details if linked
    let decisionPackageInfo = null;
    if (workflow.decisionPackageId) {
      const dp = await prisma.decisionPackage.findFirst({
        where: { id: workflow.decisionPackageId, tenantId },
        select: {
          id: true,
          title: true,
          decision: true,
          trigger: {
            select: {
              id: true,
              severity: true,
              title: true,
              deadlineDate: true,
            },
          },
        },
      });
      decisionPackageInfo = dp;
    }

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        workflowId: id,
        workflowType: workflow.workflowType,
        status: workflow.status,
        totalSteps,
        completedSteps,
        progressPercentage,
        durationMs: Date.now() - requestStart,
        action: "workflow_detail",
      },
      "Retrieved workflow detail"
    );

    return NextResponse.json({
      workflow: {
        id: workflow.id,
        tenantId: workflow.tenantId,
        decisionPackageId: workflow.decisionPackageId,
        workflowType: workflow.workflowType,
        temporalWorkflowId: workflow.temporalWorkflowId,
        status: workflow.status,
        currentStep: workflow.currentStep,
        steps: steps.map((step) => ({
          name: step["name"],
          description: step["description"],
          order: step["order"],
          status: step["status"],
          assignee: step["assignee"],
          assigneeDetails: step["assignee"]
            ? assigneeMap.get(step["assignee"] as string) ?? null
            : null,
          completedAt: step["completedAt"],
        })),
        assignedTo: workflow.assignedTo,
        assignedToUsers,
        startedAt: workflow.startedAt,
        completedAt: workflow.completedAt,
        errorDetail: workflow.errorDetail,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        decisionPackage: decisionPackageInfo,
        progress: {
          totalSteps,
          completedSteps,
          inProgressSteps,
          pendingSteps,
          progressPercentage,
          elapsedDays,
        },
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "workflow_detail_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "workflow_detail_error" }, "Unexpected error retrieving workflow");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve workflow" } },
      { status: 500 }
    );
  }
}
