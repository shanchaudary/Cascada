// Cascada — Auth Register API Route
// POST /api/auth/register — Register a new user with email, password, name, and tenant slug.
// Creates the tenant and first admin user, hashes the password with bcrypt,
// and returns the user record along with a NextAuth session token.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { hashPassword } from "@/lib/auth";
import { registerSchema } from "@/lib/validation";
import {
  ValidationError,
  ConflictError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { signIn } from "@/lib/auth";
import { ZodError } from "zod";

/**
 * Transform a ZodError into our structured ValidationError format.
 */
function formatZodError(zodErr: ZodError): ValidationError {
  const fieldErrors = zodErr.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
    value: issue.path.length > 0 ? undefined : undefined,
  }));
  return new ValidationError(fieldErrors);
}

// POST /api/auth/register
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const body = await request.json();

    // Validate input with Zod
    const validated = registerSchema.safeParse(body);
    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { email, name, password, companyName, companySlug } = validated.data;

    logger.info(
      { email, companySlug, action: "register_attempt" },
      "Registration attempt received"
    );

    // Check if a tenant with this slug already exists
    const existingTenant = await prisma.tenant.findUnique({
      where: { slug: companySlug },
    });

    if (existingTenant) {
      throw new ConflictError(
        `A company with slug "${companySlug}" already exists`,
        { companySlug }
      );
    }

    // Check if the email is already registered under any tenant
    const existingUser = await prisma.user.findFirst({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictError(
        "A user with this email address already exists",
        { email }
      );
    }

    // Hash the password with bcrypt
    const passwordHash = await hashPassword(password);

    // Create tenant + first admin user in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the tenant
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug: companySlug,
          plan: "DIAGNOSTIC",
        },
      });

      // Create the first user as TENANT_ADMIN
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name,
          role: "TENANT_ADMIN",
          isActive: true,
        },
        include: { tenant: true },
      });

      return { tenant, user };
    });

    const { tenant, user } = result;

    // Create an audit log for the registration
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        action: "USER_REGISTERED",
        entityType: "User",
        entityId: user.id,
        newValue: {
          email: user.email,
          name: user.name,
          role: user.role,
          tenantSlug: tenant.slug,
          tenantName: tenant.name,
        },
        ipAddress: request.headers.get("x-forwarded-for") ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      },
    });

    const tenantLogger = createTenantLogger(tenant.id, user.id);
    tenantLogger.info(
      {
        userId: user.id,
        email: user.email,
        tenantSlug: tenant.slug,
        durationMs: Date.now() - requestStart,
      },
      "User registered successfully"
    );

    // Sign in the user via NextAuth to establish a session
    const session = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          plan: tenant.plan,
        },
        session: session ?? null,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        {
          err: error,
          code: error.code,
          statusCode: error.statusCode,
          durationMs,
          action: "register_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "register_validation_failed" },
        "Registration validation failed"
      );
      return NextResponse.json(validationError.toJSON(), {
        status: validationError.statusCode,
      });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "register_error" },
      "Unexpected error during registration"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Registration failed" } },
      { status: 500 }
    );
  }
}
