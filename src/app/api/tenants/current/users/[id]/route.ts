// Cascada — Tenant User Detail API Routes
// PATCH  /api/tenants/current/users/[id] — Update a user's role or active status
// DELETE /api/tenants/current/users/[id] — Deactivate a user (soft delete)

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import { UserRole } from "@prisma/client";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, hasPermission } from "@/lib/auth";
import { userUpdateSchema } from "@/lib/validation";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  TenantAccessError,
  ValidationError,
  ConflictError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Helper to extract and validate the current session + tenant context.
 * Returns the session user info, or throws on auth failure.
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
 * Verify that the target user belongs to the same tenant as the actor.
 * Throws TenantAccessError if there is a tenant mismatch.
 */
async function verifyTenantMembership(
  targetUserId: string,
  actorTenantId: string
) {
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, tenantId: true, email: true, name: true, role: true, isActive: true },
  });

  if (!targetUser) {
    throw new NotFoundError("User", targetUserId);
  }

  if (targetUser.tenantId !== actorTenantId) {
    throw new TenantAccessError(actorTenantId, {
      targetUserId,
      targetUserTenantId: targetUser.tenantId,
    });
  }

  return targetUser;
}

// PATCH /api/tenants/current/users/[id] — Update user role or active status
export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: targetUserId } = await context.params;
    const { userId: actorUserId, tenantId, role: actorRole } = await getAuthenticatedContext();

    // RBAC check: only TENANT_ADMIN can update user details
    if (!hasPermission(actorRole, "TENANT_ADMIN")) {
      throw new AuthorizationError("Only tenant administrators can update users", {
        userId: actorUserId,
        role: actorRole,
        requiredRole: "TENANT_ADMIN",
      });
    }

    // Verify the target user belongs to the same tenant
    const targetUser = await verifyTenantMembership(targetUserId, tenantId);

    // Prevent self-modification of role or deactivation
    if (targetUserId === actorUserId) {
      throw new ConflictError(
        "You cannot modify your own role or active status",
        { actorUserId, targetUserId }
      );
    }

    // Prevent modification of SUPER_ADMIN users
    if (targetUser.role === "SUPER_ADMIN") {
      throw new AuthorizationError(
        "Cannot modify SUPER_ADMIN users through the tenant API",
        { targetUserId, targetRole: targetUser.role }
      );
    }

    const body = await request.json();

    // Validate input with Zod
    const validated = userUpdateSchema.safeParse(body);
    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { name, role: newRole, isActive } = validated.data;

    // If changing the role, verify the actor has sufficient permissions
    // Note: SUPER_ADMIN is not in the userUpdateSchema enum, so it's already
    // blocked by Zod validation. The hasPermission check covers the rest.
    if (newRole !== undefined && newRole !== targetUser.role) {
      if (!hasPermission(actorRole, newRole)) {
        throw new AuthorizationError(
          `Cannot assign role ${newRole} — exceeds your permission level`,
          { actorRole, attemptedRole: newRole }
        );
      }
    }

    // Build the update payload with proper Prisma types
    const updateData: { name?: string; role?: UserRole; isActive?: boolean } = {};
    if (name !== undefined) updateData.name = name;
    if (newRole !== undefined) updateData.role = newRole as UserRole;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Ensure at least one field is being updated
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError(
        [{ field: "body", message: "At least one field must be provided for update" }],
        "No fields to update"
      );
    }

    // Apply the update within the tenant's RLS context
    const updatedUser = await withTenant(tenantId, async () => {
      return prisma.user.update({
        where: { id: targetUserId },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    // Create an audit log entry for the user update
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId,
        action: "USER_UPDATED",
        entityType: "User",
        entityId: targetUserId,
        oldValue: {
          name: targetUser.name,
          role: targetUser.role,
          isActive: targetUser.isActive,
        },
        newValue: updateData,
        ipAddress: request.headers.get("x-forwarded-for") ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      },
    });

    const tenantLogger = createTenantLogger(tenantId, actorUserId);
    tenantLogger.info(
      {
        actorUserId,
        actorRole,
        targetUserId,
        updatedFields: Object.keys(updateData),
        durationMs: Date.now() - requestStart,
        action: "tenant_user_updated",
      },
      "User updated in tenant"
    );

    return NextResponse.json({
      user: updatedUser,
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
          action: "tenant_user_update_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "tenant_user_update_validation_failed" },
        "User update validation failed"
      );
      return NextResponse.json(validationError.toJSON(), {
        status: validationError.statusCode,
      });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "tenant_user_update_error" },
      "Unexpected error updating user"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update user" } },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/current/users/[id] — Deactivate a user (soft delete)
export async function DELETE(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: targetUserId } = await context.params;
    const { userId: actorUserId, tenantId, role: actorRole } = await getAuthenticatedContext();

    // RBAC check: only TENANT_ADMIN can deactivate users
    if (!hasPermission(actorRole, "TENANT_ADMIN")) {
      throw new AuthorizationError("Only tenant administrators can deactivate users", {
        userId: actorUserId,
        role: actorRole,
        requiredRole: "TENANT_ADMIN",
      });
    }

    // Verify the target user belongs to the same tenant
    const targetUser = await verifyTenantMembership(targetUserId, tenantId);

    // Prevent self-deactivation
    if (targetUserId === actorUserId) {
      throw new ConflictError(
        "You cannot deactivate your own account",
        { actorUserId, targetUserId }
      );
    }

    // Prevent deactivation of SUPER_ADMIN users
    if (targetUser.role === "SUPER_ADMIN") {
      throw new AuthorizationError(
        "Cannot deactivate SUPER_ADMIN users through the tenant API",
        { targetUserId, targetRole: targetUser.role }
      );
    }

    // Check if the user is already deactivated
    if (!targetUser.isActive) {
      throw new ConflictError(
        "User is already deactivated",
        { targetUserId }
      );
    }

    // Perform soft delete by setting isActive to false within the tenant RLS context
    const deactivatedUser = await withTenant(tenantId, async () => {
      return prisma.user.update({
        where: { id: targetUserId },
        data: { isActive: false },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    // Create an audit log entry for the user deactivation
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId,
        action: "USER_DEACTIVATED",
        entityType: "User",
        entityId: targetUserId,
        oldValue: {
          email: targetUser.email,
          name: targetUser.name,
          role: targetUser.role,
          isActive: true,
        },
        newValue: {
          isActive: false,
        },
        ipAddress: request.headers.get("x-forwarded-for") ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      },
    });

    const tenantLogger = createTenantLogger(tenantId, actorUserId);
    tenantLogger.info(
      {
        actorUserId,
        actorRole,
        targetUserId,
        targetUserEmail: targetUser.email,
        targetUserRole: targetUser.role,
        durationMs: Date.now() - requestStart,
        action: "tenant_user_deactivated",
      },
      "User deactivated in tenant"
    );

    return NextResponse.json({
      user: deactivatedUser,
      message: "User has been deactivated",
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
          action: "tenant_user_deactivate_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "tenant_user_deactivate_error" },
      "Unexpected error deactivating user"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to deactivate user" } },
      { status: 500 }
    );
  }
}
