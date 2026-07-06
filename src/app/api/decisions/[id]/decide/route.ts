// Cascada — Decision Action API Route
// POST /api/decisions/[id]/decide — Make decision (accept/reject/defer/partial), RBAC: canDecide() required

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canDecide } from "@/lib/auth";
import { decisionDecideSchema } from "@/lib/validation";
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

// POST /api/decisions/[id]/decide — Make decision on a decision package
export async function POST(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with canDecide permission can make decisions
    if (!canDecide(role)) {
      throw new AuthorizationError("Insufficient permissions to make decisions. EXECUTIVE or TENANT_ADMIN role required.", {
        userId,
        role,
        requiredPermission: "canDecide",
      });
    }

    const body = await request.json();
    const validated = decisionDecideSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { decision, notes } = validated.data;

    // Verify the decision package exists and belongs to the tenant
    const decisionPackage = await withTenant(tenantId, async () => {
      return prisma.decisionPackage.findFirst({
        where: { id, tenantId },
        include: {
          trigger: {
            select: {
              id: true,
              status: true,
              severity: true,
              title: true,
            },
          },
        },
      });
    });

    if (!decisionPackage) {
      throw new NotFoundError("DecisionPackage", id);
    }

    // Business rule: cannot decide on an already-decided package
    if (decisionPackage.decision !== null) {
      throw new ConflictError(
        `This decision package has already been decided as "${decisionPackage.decision}"`,
        {
          decisionPackageId: id,
          existingDecision: decisionPackage.decision,
          decidedBy: decisionPackage.decidedBy,
          decidedAt: decisionPackage.decidedAt,
        }
      );
    }

    // Update the decision package
    const updatedPackage = await withTenant(tenantId, async () => {
      return prisma.decisionPackage.update({
        where: { id },
        data: {
          decision,
          decidedBy: userId,
          decidedAt: new Date(),
          decisionNotes: notes ?? null,
        },
        select: {
          id: true,
          title: true,
          decision: true,
          decidedBy: true,
          decidedAt: true,
          decisionNotes: true,
          trigger: {
            select: {
              id: true,
              severity: true,
              title: true,
            },
          },
        },
      });
    });

    // If the decision is "accept", update the trigger status to DECISION_MADE
    if (decision === "accept" || decision === "partial") {
      await prisma.cascadeTrigger.update({
        where: { id: decisionPackage.trigger.id },
        data: { status: "DECISION_MADE" },
      });
    }

    // If the decision is "reject", update the trigger status to DISMISSED
    if (decision === "reject") {
      await prisma.cascadeTrigger.update({
        where: { id: decisionPackage.trigger.id },
        data: { status: "DISMISSED" },
      });
    }

    // If the decision is "defer", keep the current status but no escalation
    // The trigger stays in DECISION_PACKAGE_READY status

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "DECISION_MADE",
        entityType: "DecisionPackage",
        entityId: id,
        oldValue: {
          decision: null,
          triggerId: decisionPackage.trigger.id,
          triggerTitle: decisionPackage.trigger.title,
        },
        newValue: {
          decision,
          decidedBy: userId,
          decidedAt: updatedPackage.decidedAt,
          decisionNotes: notes ?? null,
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
        decisionPackageId: id,
        decision,
        triggerId: decisionPackage.trigger.id,
        triggerSeverity: decisionPackage.trigger.severity,
        durationMs: Date.now() - requestStart,
        action: "decision_made",
      },
      `Decision made: ${decision} on package ${id}`
    );

    return NextResponse.json({
      decisionPackage: updatedPackage,
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "decision_decide_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "decision_decide_validation_failed" },
        "Decision validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "decision_decide_error" }, "Unexpected error making decision");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to make decision" } },
      { status: 500 }
    );
  }
}
