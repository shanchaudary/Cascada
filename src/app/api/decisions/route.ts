// Cascada — Decision Packages API Routes
// GET /api/decisions — List decision packages with filter by status, severity, pagination

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import { paginationSchema } from "@/lib/validation";
import {
  AuthenticationError,
  CascadaError,
  ValidationError,
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
function parseDecisionQueryFromUrl(url: string) {
  const { searchParams } = new URL(url);

  const pagination = paginationSchema.parse({
    page: searchParams.get("page") ?? "1",
    limit: searchParams.get("limit") ?? "20",
    sortBy: searchParams.get("sortBy") ?? "generatedAt",
    sortOrder: searchParams.get("sortOrder") ?? "desc",
  });

  const decision = searchParams.get("decision") ?? undefined;
  const severity = searchParams.get("severity") ?? undefined;
  const triggerStatus = searchParams.get("triggerStatus") ?? undefined;
  const undelivered = searchParams.get("undelivered") === "true" ? true : undefined;

  return { pagination, decision, severity, triggerStatus, undelivered };
}

// GET /api/decisions — List decision packages with filters
export async function GET(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const { pagination, decision, severity, triggerStatus, undelivered } =
      parseDecisionQueryFromUrl(request.url);
    const { page, limit, sortBy, sortOrder } = pagination;

    // Build the where clause for decision packages
    const where: Record<string, unknown> = { tenantId };

    if (decision) {
      where["decision"] = decision;
    }

    if (severity) {
      where["trigger"] = { severity };
    }

    if (triggerStatus) {
      where["trigger"] = { ...(where["trigger"] as Record<string, unknown> | undefined), status: triggerStatus };
    }

    if (undelivered) {
      where["deliveredAt"] = null;
    }

    // Build the orderBy clause
    const orderBy: Record<string, string> = {};
    orderBy[sortBy ?? "generatedAt"] = sortOrder;

    const totalDecisions = await prisma.decisionPackage.count({ where });

    const decisionPackages = await withTenant(tenantId, async () => {
      return prisma.decisionPackage.findMany({
        where,
        select: {
          id: true,
          title: true,
          summary: true,
          recommendation: true,
          decision: true,
          decidedBy: true,
          decidedAt: true,
          generatedAt: true,
          deliveredAt: true,
          deliveryMethod: true,
          trigger: {
            select: {
              id: true,
              triggerType: true,
              severity: true,
              status: true,
              title: true,
              cascadeDepth: true,
              cascadeBreadth: true,
              totalSkusAffected: true,
              estimatedCostMin: true,
              estimatedCostMax: true,
              deadlineDate: true,
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });
    });

    const totalPages = Math.ceil(totalDecisions / limit);

    // Compute summary statistics
    const pendingCount = decisionPackages.filter((dp) => dp.decision === null).length;
    const decidedCount = decisionPackages.filter((dp) => dp.decision !== null).length;
    const criticalCount = decisionPackages.filter(
      (dp) => dp.trigger.severity === "CRITICAL"
    ).length;
    const highCount = decisionPackages.filter(
      (dp) => dp.trigger.severity === "HIGH"
    ).length;

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        page,
        limit,
        totalDecisions,
        filters: { decision, severity, triggerStatus, undelivered },
        pendingCount,
        decidedCount,
        durationMs: Date.now() - requestStart,
        action: "decisions_list",
      },
      "Listed decision packages"
    );

    return NextResponse.json({
      decisions: decisionPackages.map((dp) => ({
        id: dp.id,
        title: dp.title,
        summary: dp.summary,
        recommendation: dp.recommendation,
        decision: dp.decision,
        decidedBy: dp.decidedBy,
        decidedAt: dp.decidedAt,
        generatedAt: dp.generatedAt,
        deliveredAt: dp.deliveredAt,
        deliveryMethod: dp.deliveryMethod,
        trigger: dp.trigger,
      })),
      pagination: {
        page,
        limit,
        totalItems: totalDecisions,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      summary: {
        pendingCount,
        decidedCount,
        criticalCount,
        highCount,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "decisions_list_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "decisions_list_error" }, "Unexpected error listing decision packages");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list decision packages" } },
      { status: 500 }
    );
  }
}
