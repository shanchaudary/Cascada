// Cascada — Workflow Steps API Route
// GET /api/workflows/[id]/steps — Workflow steps with status and assignees

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import { paginationSchema } from "@/lib/validation";
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

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

/**
 * Transform a ZodError into our structured ValidationError format.
 */
function formatZodError(zodErr: ZodError): ValidationError {
  const fieldErrors = zodErr.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
  return new ValidationError(fieldErrors);
}

// GET /api/workflows/[id]/steps — Workflow steps with status and assignees
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: workflowId } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // Verify the workflow exists and belongs to the tenant
    const workflow = await withTenant(tenantId, async () => {
      return prisma.workflowInstance.findFirst({
        where: { id: workflowId, tenantId },
      });
    });

    if (!workflow) {
      throw new NotFoundError("WorkflowInstance", workflowId);
    }

    // Parse optional pagination (useful for workflows with many steps)
    const { searchParams } = new URL(request.url);
    const pagination = paginationSchema.parse({
      page: searchParams.get("page") ?? "1",
      limit: searchParams.get("limit") ?? "50",
      sortBy: searchParams.get("sortBy") ?? "order",
      sortOrder: searchParams.get("sortOrder") ?? "asc",
    });

    const statusFilter = searchParams.get("status") ?? undefined;

    // Parse and filter steps
    const allSteps = workflow.steps as Record<string, unknown>[];

    let filteredSteps = allSteps;
    if (statusFilter) {
      filteredSteps = allSteps.filter((step) => step["status"] === statusFilter);
    }

    // Collect all unique assignee IDs from steps
    const assigneeIds = filteredSteps
      .map((step) => step["assignee"] as string | null)
      .filter((assignee): assignee is string => assignee !== null);
    const uniqueAssigneeIds = [...new Set(assigneeIds)];

    // Also collect assignee IDs from the approvedBy field
    const approverIds = filteredSteps
      .map((step) => step["approvedBy"] as string | null)
      .filter((approver): approver is string => approver !== null);
    const uniqueApproverIds = [...new Set(approverIds)];

    // Resolve all user details at once
    const allUserIds = [...new Set([...uniqueAssigneeIds, ...uniqueApproverIds])];
    const userDetails = allUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: allUserIds } },
          select: { id: true, name: true, email: true, role: true },
        })
      : [];

    const userMap = new Map(userDetails.map((u) => [u.id, u]));

    // Enrich steps with user details
    const enrichedSteps = filteredSteps.map((step) => ({
      name: step["name"] as string,
      description: step["description"] as string,
      order: step["order"] as number,
      status: step["status"] as string,
      assignee: step["assignee"] as string | null,
      assigneeDetails: step["assignee"]
        ? userMap.get(step["assignee"] as string) ?? null
        : null,
      approvedBy: step["approvedBy"] as string | null,
      approverDetails: step["approvedBy"]
        ? userMap.get(step["approvedBy"] as string) ?? null
        : null,
      approvalNotes: step["approvalNotes"] as string | null,
      rejectedBy: step["rejectedBy"] as string | null,
      rejectionReason: step["rejectionReason"] as string | null,
      completedAt: step["completedAt"] as string | null,
      isCurrentStep: step["name"] === workflow.currentStep,
    }));

    // Sort steps by the specified field
    const { page, limit, sortBy, sortOrder } = pagination;
    const sortedSteps = [...enrichedSteps].sort((a, b) => {
      const aVal = a[sortBy as keyof typeof a];
      const bVal = b[sortBy as keyof typeof b];

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal ?? "");
      const bStr = String(bVal ?? "");
      return sortOrder === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });

    // Apply pagination
    const totalSteps = sortedSteps.length;
    const paginatedSteps = sortedSteps.slice(
      (page - 1) * limit,
      page * limit
    );

    const totalPages = Math.ceil(totalSteps / limit);

    // Compute step-level statistics
    const completedCount = enrichedSteps.filter((s) => s.status === "completed").length;
    const inProgressCount = enrichedSteps.filter((s) => s.status === "in_progress").length;
    const pendingCount = enrichedSteps.filter((s) => s.status === "pending").length;
    const rejectedCount = enrichedSteps.filter((s) => s.status === "rejected").length;

    // Identify the current step and next step
    const currentStepIndex = allSteps.findIndex((s) => s["name"] === workflow.currentStep);
    const nextStep = currentStepIndex >= 0 && currentStepIndex + 1 < allSteps.length
      ? allSteps[currentStepIndex + 1]
      : undefined;
    const nextStepName = nextStep ? (nextStep["name"] as string) : null;

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        workflowId,
        totalSteps: allSteps.length,
        currentStep: workflow.currentStep,
        nextStep: nextStepName,
        durationMs: Date.now() - requestStart,
        action: "workflow_steps_list",
      },
      "Listed workflow steps"
    );

    return NextResponse.json({
      steps: paginatedSteps,
      workflow: {
        id: workflow.id,
        workflowType: workflow.workflowType,
        status: workflow.status,
        currentStep: workflow.currentStep,
        nextStep: nextStepName,
        startedAt: workflow.startedAt,
        completedAt: workflow.completedAt,
      },
      pagination: {
        page,
        limit,
        totalItems: totalSteps,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      summary: {
        totalSteps: allSteps.length,
        completedCount,
        inProgressCount,
        pendingCount,
        rejectedCount,
        progressPercentage: allSteps.length > 0
          ? Math.round((completedCount / allSteps.length) * 100)
          : 0,
        currentStepIndex: currentStepIndex >= 0 ? currentStepIndex + 1 : 0,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "workflow_steps_list_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "workflow_steps_list_error" }, "Unexpected error listing workflow steps");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list workflow steps" } },
      { status: 500 }
    );
  }
}
