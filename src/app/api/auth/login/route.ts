// Cascada — Auth Login API Route
// POST /api/auth/login — Authenticate a user with email + password.
// Validates input via Zod, delegates credential verification to NextAuth,
// and returns session data with tenant context on success.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { signIn } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import {
  ValidationError,
  InvalidCredentialsError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

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

// POST /api/auth/login
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const body = await request.json();

    // Validate input with Zod
    const validated = loginSchema.safeParse(body);
    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { email, password } = validated.data;
    const tenantSlug = typeof body.tenantSlug === "string" ? body.tenantSlug : undefined;

    logger.info({ email, tenantSlug, action: "login_attempt" }, "Login attempt received");

    // Pre-flight check: verify user exists before calling NextAuth signIn.
    // This gives us better error messages and allows tenant disambiguation.
    const users = await prisma.user.findMany({
      where: { email, isActive: true },
      include: { tenant: true },
    });

    if (users.length === 0) {
      logger.warn(
        { email, action: "login_user_not_found" },
        "Login attempt for non-existent or inactive user"
      );
      // Deliberately return a generic invalid credentials error to prevent
      // email enumeration attacks
      throw new InvalidCredentialsError();
    }

    // If a tenantSlug is provided for disambiguation, filter to that tenant
    const matchingUser = tenantSlug
      ? users.find((u) => u.tenant.slug === tenantSlug)
      : users[0];

    if (!matchingUser) {
      logger.warn(
        { email, tenantSlug, action: "login_tenant_mismatch" },
        "Login attempt with non-matching tenant slug"
      );
      throw new InvalidCredentialsError();
    }

    // Delegate credential verification to NextAuth
    const authResult = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (!authResult) {
      logger.warn(
        { email, action: "login_invalid_credentials" },
        "Login failed — invalid credentials via NextAuth"
      );
      throw new InvalidCredentialsError();
    }

    // Log the successful authentication
    const tenantLogger = createTenantLogger(matchingUser.tenantId, matchingUser.id);
    tenantLogger.info(
      {
        userId: matchingUser.id,
        email: matchingUser.email,
        role: matchingUser.role,
        tenantSlug: matchingUser.tenant.slug,
        durationMs: Date.now() - requestStart,
        action: "login_success",
      },
      "User logged in successfully"
    );

    // Create an audit log entry for the login event
    await prisma.auditLog.create({
      data: {
        tenantId: matchingUser.tenantId,
        userId: matchingUser.id,
        action: "USER_LOGIN",
        entityType: "User",
        entityId: matchingUser.id,
        ipAddress: request.headers.get("x-forwarded-for") ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      },
    });

    return NextResponse.json({
      user: {
        id: matchingUser.id,
        email: matchingUser.email,
        name: matchingUser.name,
        role: matchingUser.role,
        tenantId: matchingUser.tenantId,
      },
      tenant: {
        id: matchingUser.tenant.id,
        name: matchingUser.tenant.name,
        slug: matchingUser.tenant.slug,
        plan: matchingUser.tenant.plan,
      },
      session: authResult,
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
          action: "login_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "login_validation_failed" },
        "Login validation failed"
      );
      return NextResponse.json(validationError.toJSON(), {
        status: validationError.statusCode,
      });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "login_error" },
      "Unexpected error during login"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Login failed" } },
      { status: 500 }
    );
  }
}
