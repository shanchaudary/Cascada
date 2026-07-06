// Cascada — Workflows API Routes
// GET  /api/workflows — List workflows with filter by status/type
// POST /api/workflows — Create workflow instance

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { paginationSchema, workflowCreateSchema } from "@/lib/validation";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

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
 * Parse pagination and filter parameters from the request URL search params.
 */
function parseWorkflowQueryFromUrl(url: string) {
  const { searchParams } = new URL(url);

  const pagination = paginationSchema.parse({
    page: searchParams.get("page") ?? "1",
    limit: searchParams.get("limit") ?? "20",
    sortBy: searchParams.get("sortBy") ?? "createdAt",
    sortOrder: searchParams.get("sortOrder") ?? "desc",
  });

  const status = searchParams.get("status") ?? undefined;
  const workflowType = searchParams.get("workflowType") ?? undefined;
  const assignedTo = searchParams.get("assignedTo") ?? undefined;
  const decisionPackageId = searchParams.get("decisionPackageId") ?? undefined;

  return { pagination, status, workflowType, assignedTo, decisionPackageId };
}

// GET /api/workflows — List workflows with filters
export async function GET(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const { pagination, status, workflowType, assignedTo, decisionPackageId } =
      parseWorkflowQueryFromUrl(request.url);
    const { page, limit, sortBy, sortOrder } = pagination;

    // Build the where clause
    const where: Record<string, unknown> = { tenantId };

    if (status) {
      where["status"] = status;
    }

    if (workflowType) {
      where["workflowType"] = workflowType;
    }

    if (assignedTo) {
      where["assignedTo"] = { has: assignedTo };
    }

    if (decisionPackageId) {
      where["decisionPackageId"] = decisionPackageId;
    }

    // Build the orderBy clause
    const orderBy: Record<string, string> = {};
    orderBy[sortBy ?? "createdAt"] = sortOrder;

    const totalWorkflows = await prisma.workflowInstance.count({ where });

    const workflows = await withTenant(tenantId, async () => {
      return prisma.workflowInstance.findMany({
        where,
        select: {
          id: true,
          decisionPackageId: true,
          workflowType: true,
          status: true,
          currentStep: true,
          assignedTo: true,
          startedAt: true,
          completedAt: true,
          errorDetail: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });
    });

    const totalPages = Math.ceil(totalWorkflows / limit);

    // Compute summary statistics
    const statusCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};
    for (const wf of workflows) {
      const wfStatus = wf.status as string;
      statusCounts[wfStatus] = (statusCounts[wfStatus] ?? 0) + 1;
      typeCounts[wf.workflowType] = (typeCounts[wf.workflowType] ?? 0) + 1;
    }

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        page,
        limit,
        totalWorkflows,
        filters: { status, workflowType, assignedTo, decisionPackageId },
        durationMs: Date.now() - requestStart,
        action: "workflows_list",
      },
      "Listed workflows"
    );

    return NextResponse.json({
      workflows,
      pagination: {
        page,
        limit,
        totalItems: totalWorkflows,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      summary: {
        statusCounts,
        typeCounts,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "workflows_list_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "workflows_list_error" }, "Unexpected error listing workflows");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list workflows" } },
      { status: 500 }
    );
  }
}

// POST /api/workflows — Create a new workflow instance
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can create workflows
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to create workflows", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    const body = await request.json();
    const validated = workflowCreateSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { decisionPackageId, workflowType, assignedTo, notes } = validated.data;

    // If a decision package ID is provided, verify it exists and belongs to the tenant
    if (decisionPackageId) {
      const decisionPackage = await prisma.decisionPackage.findFirst({
        where: { id: decisionPackageId, tenantId },
        select: { id: true, decision: true, title: true },
      });

      if (!decisionPackage) {
        throw new NotFoundError("DecisionPackage", decisionPackageId);
      }

      // Business rule: a workflow can only be created for an accepted or partially-accepted decision
      if (decisionPackage.decision !== "accept" && decisionPackage.decision !== "partial") {
        throw new ValidationError([
          {
            field: "decisionPackageId",
            message: `A workflow can only be created for an accepted or partially-accepted decision. Current decision: ${decisionPackage.decision ?? "none"}`,
            value: decisionPackage.decision,
          },
        ]);
      }

      // Check if a workflow is already running for this decision package
      const existingWorkflow = await prisma.workflowInstance.findFirst({
        where: {
          decisionPackageId,
          tenantId,
          status: { in: ["PENDING", "RUNNING", "AWAITING_APPROVAL"] },
        },
      });

      if (existingWorkflow) {
        throw new ConflictError(
          `An active workflow already exists for decision package ${decisionPackageId}`,
          { decisionPackageId, existingWorkflowId: existingWorkflow.id }
        );
      }
    }

    // Verify all assigned users exist in the tenant
    const assignedUsers = await prisma.user.findMany({
      where: {
        id: { in: assignedTo },
        tenantId,
        isActive: true,
      },
      select: { id: true, name: true, role: true },
    });

    if (assignedUsers.length !== assignedTo.length) {
      const foundIds = new Set(assignedUsers.map((u) => u.id));
      const missingIds = assignedTo.filter((id) => !foundIds.has(id));
      throw new ValidationError(
        missingIds.map((id) => ({
          field: "assignedTo",
          message: `User with id "${id}" not found or inactive in this tenant`,
          value: id,
        })),
        "One or more assigned users not found"
      );
    }

    // Define workflow step templates based on type
    const stepTemplates: Record<string, Array<{ name: string; description: string }>> = {
      reformulation: [
        { name: "impact_assessment", description: "Assess the full impact of the regulatory change on current formulations" },
        { name: "rd_review", description: "R&D team reviews reformulation options and feasibility" },
        { name: "supplier_evaluation", description: "Evaluate substitute ingredient availability and supplier capability" },
        { name: "sensory_testing", description: "Conduct sensory testing on reformulated product" },
        { name: "stability_testing", description: "Validate shelf life and stability of reformulated product" },
        { name: "regulatory_filing", description: "File regulatory notifications for formulation change" },
        { name: "label_update", description: "Update product labels to reflect new formulation" },
        { name: "production_handoff", description: "Hand off approved formulation to manufacturing" },
      ],
      label_change: [
        { name: "label_review", description: "Review current label against new regulatory requirements" },
        { name: "design_update", description: "Update label design to meet compliance requirements" },
        { name: "legal_review", description: "Legal team reviews updated label for compliance" },
        { name: "production_handoff", description: "Hand off approved label to manufacturing for printing" },
      ],
      product_withdrawal: [
        { name: "withdrawal_assessment", description: "Assess scope and timeline of product withdrawal" },
        { name: "customer_notification", description: "Notify affected customers and distributors" },
        { name: "inventory_recall", description: "Coordinate inventory recall from warehouses and retail" },
        { name: "regulatory_filing", description: "File regulatory notifications for product withdrawal" },
        { name: "disposition", description: "Determine disposition of recalled inventory" },
      ],
      compliance_review: [
        { name: "document_review", description: "Review all compliance documentation for accuracy" },
        { name: "gap_analysis", description: "Identify gaps between current state and regulatory requirements" },
        { name: "remediation_plan", description: "Create and approve remediation plan" },
        { name: "implementation", description: "Implement approved remediation actions" },
        { name: "verification", description: "Verify all remediation actions are complete and effective" },
      ],
    };

    const steps = stepTemplates[workflowType] ?? [];
    const stepsWithStatus = steps.map((step, index) => ({
      ...step,
      order: index,
      status: index === 0 ? "in_progress" : "pending",
      assignee: null as string | null,
      completedAt: null as string | null,
    }));

    const currentStepName = steps.length > 0 ? steps[0]?.name ?? null : null;

    // Create the workflow instance
    const workflow = await withTenant(tenantId, async () => {
      return prisma.workflowInstance.create({
        data: {
          tenantId,
          decisionPackageId: decisionPackageId ?? null,
          workflowType,
          status: "PENDING",
          currentStep: currentStepName,
          steps: JSON.parse(JSON.stringify(stepsWithStatus)),
          assignedTo,
          startedAt: null,
          completedAt: null,
          errorDetail: null,
        },
        select: {
          id: true,
          decisionPackageId: true,
          workflowType: true,
          status: true,
          currentStep: true,
          steps: true,
          assignedTo: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "WORKFLOW_CREATED",
        entityType: "WorkflowInstance",
        entityId: workflow.id,
        newValue: {
          workflowType,
          decisionPackageId,
          assignedTo,
          stepCount: steps.length,
          currentStep: currentStepName,
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
        workflowId: workflow.id,
        workflowType,
        decisionPackageId,
        assignedTo,
        stepCount: steps.length,
        durationMs: Date.now() - requestStart,
        action: "workflow_created",
      },
      "Workflow instance created"
    );

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "workflow_create_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "workflow_create_validation_failed" },
        "Workflow creation validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "workflow_create_error" }, "Unexpected error creating workflow");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create workflow" } },
      { status: 500 }
    );
  }
}
