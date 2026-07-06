// Cascada — Workflow Approve API Route
// POST /api/workflows/[id]/approve — Approve current workflow step, RBAC: canDecide() required

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canDecide } from "@/lib/auth";
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
 * Zod schema for the approve action body.
 */
const approveActionSchema = z.object({
  notes: z.string().max(5000).optional(),
});

// POST /api/workflows/[id]/approve — Approve current workflow step
export async function POST(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: workflowId } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with canDecide permission can approve workflow steps
    if (!canDecide(role)) {
      throw new AuthorizationError("Insufficient permissions to approve workflow steps. EXECUTIVE or TENANT_ADMIN role required.", {
        userId,
        role,
        requiredPermission: "canDecide",
      });
    }

    const body = await request.json();
    const validated = approveActionSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { notes } = validated.data;

    // Verify the workflow exists and belongs to the tenant
    const workflow = await withTenant(tenantId, async () => {
      return prisma.workflowInstance.findFirst({
        where: { id: workflowId, tenantId },
      });
    });

    if (!workflow) {
      throw new NotFoundError("WorkflowInstance", workflowId);
    }

    // Business rule: can only approve workflows in AWAITING_APPROVAL or RUNNING status
    if (workflow.status !== "AWAITING_APPROVAL" && workflow.status !== "RUNNING") {
      throw new WorkflowError(
        `Cannot approve a workflow in ${workflow.status} status`,
        workflow.workflowType,
        { workflowId, currentStatus: workflow.status }
      );
    }

    // Parse current steps and advance
    const steps = workflow.steps as Record<string, unknown>[];
    const currentStepIndex = steps.findIndex(
      (step) => step["name"] === workflow.currentStep
    );

    if (currentStepIndex === -1 && workflow.currentStep !== null) {
      throw new WorkflowError(
        `Current step "${workflow.currentStep}" not found in workflow step definitions`,
        workflow.workflowType,
        { workflowId, currentStep: workflow.currentStep }
      );
    }

    const now = new Date().toISOString();

    // Mark the current step as completed
    if (currentStepIndex >= 0) {
      steps[currentStepIndex] = {
        ...steps[currentStepIndex],
        status: "completed",
        completedAt: now,
        approvedBy: userId,
        approvalNotes: notes ?? null,
      };
    }

    // Determine the next step
    const nextStepIndex = currentStepIndex + 1;
    const hasNextStep = nextStepIndex < steps.length;
    let newStatus: string = workflow.status;
    let newCurrentStep: string | null = workflow.currentStep;
    let completedAt: Date | null = null;
    let startedAt: Date | null = workflow.startedAt;

    if (hasNextStep) {
      // Advance to the next step
      steps[nextStepIndex] = {
        ...steps[nextStepIndex],
        status: "in_progress",
        assignee: steps[nextStepIndex]?.["assignee"] ?? userId,
      };
      newCurrentStep = steps[nextStepIndex]["name"] as string;
      newStatus = "RUNNING";

      // Set startedAt if not already set
      if (!startedAt) {
        startedAt = new Date();
      }
    } else {
      // No more steps — workflow is complete
      newCurrentStep = null;
      newStatus = "COMPLETED";
      completedAt = new Date();
    }

    // Update the workflow
    const updatedWorkflow = await withTenant(tenantId, async () => {
      return prisma.workflowInstance.update({
        where: { id: workflowId },
        data: {
          status: newStatus as "PENDING" | "RUNNING" | "AWAITING_APPROVAL" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT",
          currentStep: newCurrentStep,
          steps: JSON.parse(JSON.stringify(steps)),
          startedAt,
          completedAt,
        },
        select: {
          id: true,
          workflowType: true,
          status: true,
          currentStep: true,
          steps: true,
          startedAt: true,
          completedAt: true,
          updatedAt: true,
        },
      });
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "WORKFLOW_STEP_APPROVED",
        entityType: "WorkflowInstance",
        entityId: workflowId,
        oldValue: {
          stepName: workflow.currentStep,
          stepStatus: currentStepIndex >= 0 ? (steps[currentStepIndex]?.["status"] as string | null) : null,
          workflowStatus: workflow.status,
        },
        newValue: {
          stepName: workflow.currentStep,
          newStepStatus: "completed",
          nextStep: newCurrentStep,
          workflowStatus: newStatus,
          approvedBy: userId,
          notes,
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
        approvedStep: workflow.currentStep,
        nextStep: newCurrentStep,
        workflowStatus: newStatus,
        durationMs: Date.now() - requestStart,
        action: "workflow_step_approved",
      },
      `Workflow step approved: ${workflow.currentStep}`
    );

    return NextResponse.json({
      workflow: updatedWorkflow,
      approval: {
        stepName: workflow.currentStep,
        approvedBy: userId,
        approvedAt: now,
        notes: notes ?? null,
        nextStep: newCurrentStep,
        isComplete: !hasNextStep,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "workflow_approve_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "workflow_approve_validation_failed" },
        "Workflow approval validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "workflow_approve_error" }, "Unexpected error approving workflow step");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to approve workflow step" } },
      { status: 500 }
    );
  }
}
