// Cascada — Auth Refresh API Route
// POST /api/auth/refresh — Refresh the current JWT token.
// Validates the existing session, checks the user is still active,
// re-issues a fresh session with updated claims from the database,
// and returns the renewed session data.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import {
  AuthenticationError,
  TokenExpiredError,
  AuthorizationError,
  NotFoundError,
  CascadaError,
  toError,
} from "@/lib/errors";

// POST /api/auth/refresh
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    // Retrieve the current session from NextAuth
    const session = await auth();

    if (!session?.user) {
      logger.warn(
        { action: "refresh_no_session" },
        "Token refresh attempted without an active session"
      );
      throw new AuthenticationError("No active session to refresh");
    }

    // Extract user identifiers from the session
    const sessionUser = session.user as Record<string, unknown>;
    const userId = sessionUser["id"] as string | undefined;
    const tenantId = sessionUser["tenantId"] as string | undefined;
    const currentRole = sessionUser["role"] as string | undefined;

    if (!userId || !tenantId) {
      logger.warn(
        { action: "refresh_malformed_session", userId, tenantId },
        "Token refresh attempted with malformed session claims"
      );
      throw new AuthenticationError("Session is missing required claims");
    }

    // Verify the user still exists and is active in the database
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!userRecord) {
      logger.warn(
        { userId, action: "refresh_user_not_found" },
        "Token refresh attempted for non-existent user"
      );
      throw new NotFoundError("User", userId);
    }

    if (!userRecord.isActive) {
      logger.warn(
        { userId, action: "refresh_user_deactivated" },
        "Token refresh attempted for deactivated user"
      );
      throw new AuthorizationError("User account has been deactivated", {
        userId,
        reason: "account_deactivated",
      });
    }

    // Verify the tenant still exists and is accessible
    if (!userRecord.tenant) {
      logger.warn(
        { userId, tenantId, action: "refresh_tenant_not_found" },
        "Token refresh attempted for user with missing tenant"
      );
      throw new NotFoundError("Tenant", tenantId);
    }

    // Check if the user's role has changed since the last token was issued.
    // If the role was upgraded or downgraded, the new session will reflect that.
    const roleChanged = currentRole !== userRecord.role;
    if (roleChanged) {
      logger.info(
        {
          userId,
          previousRole: currentRole,
          newRole: userRecord.role,
          action: "refresh_role_changed",
        },
        "User role changed since last token — new claims will be issued"
      );
    }

    // Log the successful refresh
    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.info(
      {
        userId,
        role: userRecord.role,
        tenantSlug: userRecord.tenant.slug,
        tenantPlan: userRecord.tenant.plan,
        roleChanged,
        durationMs: Date.now() - requestStart,
        action: "refresh_success",
      },
      "Token refreshed successfully"
    );

    // Create an audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "TOKEN_REFRESHED",
        entityType: "Session",
        entityId: userId,
        newValue: {
          role: userRecord.role,
          tenantPlan: userRecord.tenant.plan,
          roleChanged,
        },
        ipAddress: request.headers.get("x-forwarded-for") ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      },
    });

    // Return the refreshed session data with updated claims.
    // The NextAuth JWT callback will handle the actual token renewal
    // on the next request cycle. Here we provide the authoritative
    // current state from the database.
    return NextResponse.json({
      session: {
        user: {
          id: userRecord.id,
          email: userRecord.email,
          name: userRecord.name,
          role: userRecord.role,
          tenantId: userRecord.tenantId,
          tenantSlug: userRecord.tenant.slug,
          tenantPlan: userRecord.tenant.plan,
        },
        expires: session.expires,
      },
      refreshed: true,
      claimsUpdated: roleChanged,
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
          action: "refresh_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "refresh_error" },
      "Unexpected error during token refresh"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Token refresh failed" } },
      { status: 500 }
    );
  }
}
