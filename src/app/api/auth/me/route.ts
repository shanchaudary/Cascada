// Cascada — Auth Me API Route
// GET /api/auth/me — Get the current authenticated user profile with tenant info.
// Reads the session from NextAuth, fetches the latest user and tenant data
// from the database, and returns a comprehensive profile object.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import {
  AuthenticationError,
  NotFoundError,
  CascadaError,
  toError,
} from "@/lib/errors";

// GET /api/auth/me
export async function GET(request: NextRequest) {
  const requestStart = Date.now();

  try {
    // Retrieve the current session from NextAuth
    const session = await auth();

    if (!session?.user) {
      logger.warn(
        { action: "me_no_session" },
        "Profile request without an active session"
      );
      throw new AuthenticationError("Authentication required to access profile");
    }

    // Extract user identifiers from the session
    const sessionUser = session.user as Record<string, unknown>;
    const userId = sessionUser["id"] as string | undefined;
    const tenantId = sessionUser["tenantId"] as string | undefined;

    if (!userId) {
      logger.warn(
        { action: "me_malformed_session" },
        "Profile request with session missing user ID"
      );
      throw new AuthenticationError("Session is missing user identifier");
    }

    // Fetch the user with tenant and related stats from the database
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            createdAt: true,
            updatedAt: true,
            // Include counts for dashboard context
            users: {
              select: { id: true, isActive: true },
            },
            erpConnections: {
              select: { id: true, syncStatus: true },
            },
          },
        },
      },
    });

    if (!userRecord) {
      logger.warn(
        { userId, action: "me_user_not_found" },
        "Profile request for non-existent user"
      );
      throw new NotFoundError("User", userId);
    }

    if (!userRecord.isActive) {
      logger.warn(
        { userId, action: "me_user_deactivated" },
        "Profile request for deactivated user"
      );
      throw new AuthenticationError("User account has been deactivated");
    }

    // Compute tenant stats for the client
    const tenantData = userRecord.tenant;
    const activeUserCount = tenantData.users.filter((u) => u.isActive).length;
    const totalUserCount = tenantData.users.length;
    const erpConnectionCount = tenantData.erpConnections.length;
    const connectedErpCount = tenantData.erpConnections.filter(
      (c) => c.syncStatus === "CONNECTED"
    ).length;

    // Log the profile access
    const tenantLogger = createTenantLogger(userRecord.tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role: userRecord.role,
        durationMs: Date.now() - requestStart,
        action: "me_success",
      },
      "User profile retrieved successfully"
    );

    return NextResponse.json({
      user: {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        role: userRecord.role,
        isActive: userRecord.isActive,
        tenantId: userRecord.tenantId,
        createdAt: userRecord.createdAt,
        updatedAt: userRecord.updatedAt,
      },
      tenant: {
        id: tenantData.id,
        name: tenantData.name,
        slug: tenantData.slug,
        plan: tenantData.plan,
        createdAt: tenantData.createdAt,
        updatedAt: tenantData.updatedAt,
        stats: {
          totalUsers: totalUserCount,
          activeUsers: activeUserCount,
          erpConnections: erpConnectionCount,
          connectedErp: connectedErpCount,
        },
      },
      session: {
        expires: session.expires,
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
          action: "me_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "me_error" },
      "Unexpected error retrieving user profile"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve profile" } },
      { status: 500 }
    );
  }
}
