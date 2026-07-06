// Cascada — Auth Logout API Route
// POST /api/auth/logout — Invalidate the current session and clear auth cookies.
// Uses NextAuth signOut to properly revoke the JWT session server-side.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, signOut } from "@/lib/auth";
import {
  AuthenticationError,
  CascadaError,
  toError,
} from "@/lib/errors";

// POST /api/auth/logout
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    // Retrieve the current session to identify who is logging out
    const session = await auth();

    if (!session?.user) {
      // No active session — nothing to invalidate, but still return success
      // to avoid leaking information about session state
      logger.info(
        { action: "logout_no_session" },
        "Logout requested with no active session"
      );
      return NextResponse.json(
        { message: "Logged out successfully" },
        { status: 200 }
      );
    }

    // Extract user and tenant identifiers from the session
    const sessionUser = session.user as Record<string, unknown>;
    const userId = sessionUser["id"] as string | undefined;
    const tenantId = sessionUser["tenantId"] as string | undefined;
    const role = sessionUser["role"] as string | undefined;

    logger.info(
      { userId, tenantId, role, action: "logout_attempt" },
      "Logout attempt received"
    );

    // Sign out via NextAuth — this revokes the JWT and clears cookies
    await signOut({ redirect: false });

    // Create an audit log entry for the logout event
    if (userId && tenantId) {
      const tenantLogger = createTenantLogger(tenantId, userId);
      tenantLogger.info(
        {
          userId,
          action: "logout_success",
          durationMs: Date.now() - requestStart,
        },
        "User logged out successfully"
      );

      await prisma.auditLog.create({
        data: {
          tenantId,
          userId,
          action: "USER_LOGOUT",
          entityType: "User",
          entityId: userId,
          ipAddress: request.headers.get("x-forwarded-for") ?? null,
          userAgent: request.headers.get("user-agent") ?? null,
        },
      });
    }

    // Build the response and clear the session cookies manually as a safeguard
    const response = NextResponse.json(
      { message: "Logged out successfully" },
      { status: 200 }
    );

    // Clear NextAuth session cookies
    const cookieNames = [
      "next-auth.session-token",
      "__Secure-next-auth.session-token",
      "next-auth.csrf-token",
      "__Host-next-auth.csrf-token",
      "next-auth.callback-url",
      "__Secure-next-auth.callback-url",
    ];

    for (const name of cookieNames) {
      response.cookies.set(name, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }

    return response;
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        {
          err: error,
          code: error.code,
          statusCode: error.statusCode,
          durationMs,
          action: "logout_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "logout_error" },
      "Unexpected error during logout"
    );

    // Even if logout partially fails, return success to the client
    // so they can clear their local session state
    return NextResponse.json(
      { message: "Logged out" },
      { status: 200 }
    );
  }
}
