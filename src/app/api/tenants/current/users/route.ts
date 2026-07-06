// Cascada — Tenant Users API Routes
// GET  /api/tenants/current/users — List users in the current tenant with pagination
// POST /api/tenants/current/users — Create/invite a new user to the current tenant

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, hasPermission, hashPassword } from "@/lib/auth";
import { paginationSchema, userCreateSchema } from "@/lib/validation";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
  NotFoundError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

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
 * Parse pagination parameters from the request URL search params.
 */
function parsePaginationFromUrl(url: string) {
  const { searchParams } = new URL(url);
  return paginationSchema.parse({
    page: searchParams.get("page") ?? "1",
    limit: searchParams.get("limit") ?? "20",
    sortBy: searchParams.get("sortBy") ?? undefined,
    sortOrder: searchParams.get("sortOrder") ?? "asc",
  });
}

// GET /api/tenants/current/users — List users with pagination
export async function GET(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: users must be at least VIEWER to list users
    if (!hasPermission(role, "VIEWER")) {
      throw new AuthorizationError("Insufficient permissions to view users", {
        userId,
        role,
        requiredRole: "VIEWER",
      });
    }

    // Parse pagination from query string
    const pagination = parsePaginationFromUrl(request.url);
    const { page, limit, sortBy, sortOrder } = pagination;

    // Build the sort clause
    const orderBy: Record<string, string> = {};
    if (sortBy) {
      orderBy[sortBy] = sortOrder;
    } else {
      orderBy["name"] = "asc";
    }

    // Count total users in the tenant for pagination metadata
    const totalUsers = await prisma.user.count({
      where: { tenantId },
    });

    // Fetch the paginated user list
    const users = await withTenant(tenantId, async () => {
      return prisma.user.findMany({
        where: { tenantId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });
    });

    const totalPages = Math.ceil(totalUsers / limit);

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        page,
        limit,
        totalUsers,
        durationMs: Date.now() - requestStart,
        action: "tenant_users_list",
      },
      "Listed tenant users"
    );

    return NextResponse.json({
      users,
      pagination: {
        page,
        limit,
        totalUsers,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
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
          action: "tenant_users_list_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "tenant_users_list_validation_failed" },
        "Tenant users list validation failed"
      );
      return NextResponse.json(validationError.toJSON(), {
        status: validationError.statusCode,
      });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "tenant_users_list_error" },
      "Unexpected error listing tenant users"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list users" } },
      { status: 500 }
    );
  }
}

// POST /api/tenants/current/users — Create/invite a new user
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId: actorUserId, tenantId, role: actorRole } = await getAuthenticatedContext();

    // RBAC check: only TENANT_ADMIN can create/invite users
    if (!hasPermission(actorRole, "TENANT_ADMIN")) {
      throw new AuthorizationError("Only tenant administrators can create users", {
        userId: actorUserId,
        role: actorRole,
        requiredRole: "TENANT_ADMIN",
      });
    }

    const body = await request.json();

    // Validate input with Zod
    const validated = userCreateSchema.safeParse(body);
    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { email, name, role: newRole } = validated.data;

    // Prevent creating users with a role higher than the actor's role
    // Note: SUPER_ADMIN is not in the userCreateSchema enum, so it's already
    // blocked by Zod validation. This hasPermission check also covers the case.
    if (!hasPermission(actorRole, newRole)) {
      throw new AuthorizationError(
        `Cannot create a user with role ${newRole} — exceeds your permission level`,
        { actorRole, attemptedRole: newRole }
      );
    }

    // Check if a user with this email already exists in this tenant
    const existingUser = await prisma.user.findUnique({
      where: {
        tenantId_email: { tenantId, email },
      },
    });

    if (existingUser) {
      throw new ConflictError(
        `A user with email "${email}" already exists in this tenant`,
        { email, tenantId }
      );
    }

    // Verify the tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, plan: true },
    });

    if (!tenant) {
      throw new NotFoundError("Tenant", tenantId);
    }

    // Create the new user within the tenant's RLS context
    const newUser = await withTenant(tenantId, async () => {
      return prisma.user.create({
        data: {
          tenantId,
          email,
          name,
          role: newRole,
          isActive: true,
        },
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

    // Create an audit log entry for the user creation
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actorUserId,
        action: "USER_CREATED",
        entityType: "User",
        entityId: newUser.id,
        newValue: {
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
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
        newUserId: newUser.id,
        newUserEmail: newUser.email,
        newUserRole: newUser.role,
        durationMs: Date.now() - requestStart,
        action: "tenant_user_created",
      },
      "New user created in tenant"
    );

    return NextResponse.json(
      {
        user: newUser,
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
          action: "tenant_user_create_failed",
        },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "tenant_user_create_validation_failed" },
        "User creation validation failed"
      );
      return NextResponse.json(validationError.toJSON(), {
        status: validationError.statusCode,
      });
    }

    const err = toError(error);
    logger.error(
      { err, durationMs, action: "tenant_user_create_error" },
      "Unexpected error creating user"
    );
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create user" } },
      { status: 500 }
    );
  }
}
