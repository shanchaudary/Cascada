// Cascada — Workflow Reject API Route
// POST /api/workflows/[id]/reject — Reject workflow with reason

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { z, ZodError } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  WorkflowError,
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

/**
 * Zod schema for the reject action body. Reason is required.
 */
const rejectActionSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required").max(5000),
});

// POST /api/workflows/[id]/reject — Reject workflow with reason
export async function POST(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: workflowId } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: users with write permission can reject workflows
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to reject workflows", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    const body = await request.json();
    const validated = rejectActionSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { reason } = validated.data;

    // Verify the workflow exists and belongs to the tenant
    const workflow = await withTenant(tenantId, async () => {
      return prisma.workflowInstance.findFirst({
        where: { id: workflowId, tenantId },
      });
    });

    if (!workflow) {
      throw new NotFoundError("WorkflowInstance", workflowId);
    }

    // Business rule: can only reject workflows that are in an active state
    const rejectableStatuses = ["PENDING", "RUNNING", "AWAITING_APPROVAL"];
    if (!rejectableStatuses.includes(workflow.status)) {
      throw new WorkflowError(
        `Cannot reject a workflow in ${workflow.status} status. Only ${rejectableStatuses.join(", ")} workflows can be rejected.`,
        workflow.workflowType,
        { workflowId, currentStatus: workflow.status }
      );
    }

    // Parse current steps and mark the current step as rejected
    const steps = workflow.steps as Record<string, unknown>[];
    const currentStepIndex = steps.findIndex(
      (step) => step["name"] === workflow.currentStep
    );

    const now = new Date().toISOString();

    if (currentStepIndex >= 0) {
      steps[currentStepIndex] = {
        ...steps[currentStepIndex],
        status: "rejected",
        completedAt: now,
        rejectedBy: userId,
        rejectionReason: reason,
      };
    }

    // Update the workflow to CANCELLED status
    const updatedWorkflow = await withTenant(tenantId, async () => {
      return prisma.workflowInstance.update({
        where: { id: workflowId },
        data: {
          status: "CANCELLED",
          currentStep: null,
          steps: JSON.parse(JSON.stringify(steps)),
          completedAt: new Date(),
          errorDetail: `Workflow rejected by user ${userId}: ${reason}`,
        },
        select: {
          id: true,
          workflowType: true,
          status: true,
          currentStep: true,
          steps: true,
          errorDetail: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
        },
      });
    });

    // If there's a linked decision package, note the workflow cancellation
    if (workflow.decisionPackageId) {
      const decisionPackage = await prisma.decisionPackage.findFirst({
        where: { id: workflow.decisionPackageId, tenantId },
        select: { id: true, triggerId: true },
      });

      if (decisionPackage) {
        // Update the trigger back to DECISION_MADE so a new workflow can be created
        await prisma.cascadeTrigger.update({
          where: { id: decisionPackage.triggerId },
          data: { status: "DECISION_MADE" },
        });
      }
    }

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "WORKFLOW_REJECTED",
        entityType: "WorkflowInstance",
        entityId: workflowId,
        oldValue: {
          stepName: workflow.currentStep,
          workflowStatus: workflow.status,
        },
        newValue: {
          workflowStatus: "CANCELLED",
          rejectedBy: userId,
          rejectionReason: reason,
          rejectedStep: workflow.currentStep,
        },
        ipAddress: request.headers.get("x-forwarded-for") ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      },
    });

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.info(
      {
        userId,
        role,
        workflowId,
        workflowType: workflow.workflowType,
        rejectedStep: workflow.currentStep,
        reason,
        durationMs: Date.now() - requestStart,
        action: "workflow_rejected",
      },
      `Workflow rejected at step: ${workflow.currentStep ?? "init"}`
    );

    return NextResponse.json({
      workflow: updatedWorkflow,
      rejection: {
        rejectedBy: userId,
        rejectedAt: now,
        reason,
        rejectedStep: workflow.currentStep,
        previousStatus: workflow.status,
        newStatus: "CANCELLED",
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "workflow_reject_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "workflow_reject_validation_failed" },
        "Workflow rejection validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "workflow_reject_error" }, "Unexpected error rejecting workflow");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to reject workflow" } },
      { status: 500 }
    );
  }
}
