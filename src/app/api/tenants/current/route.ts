// Cascada — Tenant Current API Routes
// GET  /api/tenants/current — Get current tenant details for the authenticated user
// PATCH /api/tenants/current — Update tenant settings (name, plan)

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import { Plan } from "@prisma/client";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, hasPermission } from "@/lib/auth";
import { tenantUpdateSchema, paginationSchema } from "@/lib/validation";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

/**
 * Helper to extract and validate the current session + tenant context.
 * Returns the session user info and the tenant record, or throws.
 */
async function getAuthenticatedTenant(request: NextRequest) {
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

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      users: {
        select: { id: true, isActive: true },
      },
      erpConnections: {
        select: { id: true, erpType: true, syncStatus: true },
      },
    },
  });

  if (!tenant) {
    throw new NotFoundError("Tenant", tenantId);
  }

  return { userId, tenantId, role, tenant, session };
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

// GET /api/tenants/current — Retrieve current tenant details
export async function GET(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role, tenant } = await getAuthenticatedTenant(request);

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        tenantSlug: tenant.slug,
        durationMs: Date.now() - requestStart,
        action: "tenant_get_current",
      },
      "Retrieved current tenant details"
    );

    const activeUserCount = tenant.users.filter((u) => u.isActive).length;
    const totalUserCount = tenant.users.length;
    const erpConnectionCount = tenant.erpConnections.length;
    const connectedErpCount = tenant.erpConnections.filter(
      (c) => c.syncStatus === "CONNECTED"
    ).length;

    return NextResponse.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
        stats: {
          totalUsers: totalUserCount,
          activeUsers: activeUserCount,
          erpConnections: erpConnectionCount,
          connectedErp: connectedErpCount,
        },
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        {
          err: error,
          code: error.code,
          statusCode: error.statusCode,
          durationMs,
          action: "tenant_get_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "tenant_get_error" },
      "Unexpected error retrieving tenant details"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve tenant" } },
      { status: 500 }
    );
  }
}

// PATCH /api/tenants/current — Update tenant settings
export async function PATCH(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role, tenant } = await getAuthenticatedTenant(request);

    // RBAC check: only TENANT_ADMIN and above can update tenant settings
    if (!hasPermission(role, "TENANT_ADMIN")) {
      throw new AuthorizationError("Only tenant administrators can update tenant settings", {
        userId,
        role,
        requiredRole: "TENANT_ADMIN",
      });
    }

    const body = await request.json();

    // Validate input with Zod
    const validated = tenantUpdateSchema.safeParse(body);
    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { name, plan } = validated.data;

    // If plan upgrade is requested, perform additional validation
    if (plan && plan !== tenant.plan) {
      const planOrder: Record<string, number> = {
        DIAGNOSTIC: 1,
        SCOUT: 2,
        PRO: 3,
        COMMAND: 4,
      };

      const currentPlanLevel = planOrder[tenant.plan] ?? 0;
      const requestedPlanLevel = planOrder[plan] ?? 0;

      // Only plan upgrades are allowed via self-service; downgrades require support
      if (requestedPlanLevel < currentPlanLevel) {
        throw new AuthorizationError(
          "Plan downgrades require contacting support",
          { currentPlan: tenant.plan, requestedPlan: plan }
        );
      }

      logger.info(
        {
          tenantId,
          userId,
          currentPlan: tenant.plan,
          requestedPlan: plan,
          action: "tenant_plan_upgrade",
        },
        "Tenant plan upgrade requested"
      );
    }

    // Build the update payload with only the fields that are provided
    const updateData: { name?: string; plan?: Plan } = {};
    if (name !== undefined) {
      updateData.name = name;
    }
    if (plan !== undefined) {
      updateData.plan = plan as Plan;
    }

    // Apply the update within the tenant's RLS context
    const updatedTenant = await withTenant(tenantId, async () => {
      return prisma.tenant.update({
        where: { id: tenantId },
        data: updateData,
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    // Create an audit log entry for the tenant update
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "TENANT_UPDATED",
        entityType: "Tenant",
        entityId: tenantId,
        oldValue: {
          name: tenant.name,
          plan: tenant.plan,
        },
        newValue: updateData,
        ipAddress: request.headers.get("x-forwarded-for") ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      },
    });

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.info(
      {
        userId,
        role,
        updatedFields: Object.keys(updateData),
        durationMs: Date.now() - requestStart,
        action: "tenant_update_success",
      },
      "Tenant settings updated successfully"
    );

    return NextResponse.json({
      tenant: updatedTenant,
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        {
          err: error,
          code: error.code,
          statusCode: error.statusCode,
          durationMs,
          action: "tenant_update_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "tenant_update_validation_failed" },
        "Tenant update validation failed"
      );
      return NextResponse.json(validationError.toJSON(), {
        status: validationError.statusCode,
      });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "tenant_update_error" },
      "Unexpected error updating tenant"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update tenant" } },
      { status: 500 }
    );
  }
}
