// Cascada — Ingredient Substitution Options API Routes
// GET  /api/ingredients/[id]/substitutions — List substitution options for ingredient
// POST /api/ingredients/[id]/substitutions — Create new substitution option

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { cuidSchema, paginationSchema } from "@/lib/validation";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { z, ZodError } from "zod";

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

/**
 * Zod schema for creating a substitution option.
 */
const substitutionCreateSchema = z.object({
  substituteIngredientId: cuidSchema,
  substitutionCost: z.string().regex(/^\d+(\.\d+)?$/).transform(Number).optional(),
  feasibilityScore: z.number().min(0).max(1).optional(),
  sensoryImpact: z.enum(["none", "minor", "moderate", "significant"]).optional(),
  shelfLifeImpact: z.enum(["none", "minor", "reduced_X_months"]).optional(),
  regulatoryRisk: z.enum(["none", "review_needed", "restricted_in_some_jurisdictions"]).optional(),
  notes: z.string().max(2000).optional(),
  source: z.enum(["ai_suggestion", "rd_validated", "supplier_recommended"]).optional(),
});

// GET /api/ingredients/[id]/substitutions — List substitution options for ingredient
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: ingredientId } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // Verify the ingredient exists and belongs to the tenant
    const ingredient = await withTenant(tenantId, async () => {
      return prisma.ingredient.findFirst({
        where: { id: ingredientId, tenantId },
        select: { id: true, name: true },
      });
    });

    if (!ingredient) {
      throw new NotFoundError("Ingredient", ingredientId);
    }

    // Parse pagination from query string
    const { searchParams } = new URL(request.url);
    const pagination = paginationSchema.parse({
      page: searchParams.get("page") ?? "1",
      limit: searchParams.get("limit") ?? "20",
      sortBy: searchParams.get("sortBy") ?? "createdAt",
      sortOrder: searchParams.get("sortOrder") ?? "desc",
    });

    const sourceFilter = searchParams.get("source") ?? undefined;
    const feasibilityMin = searchParams.get("feasibilityMin")
      ? Number(searchParams.get("feasibilityMin"))
      : undefined;

    const { page, limit, sortBy, sortOrder } = pagination;

    // Build the where clause
    const where: Record<string, unknown> = { originalIngredientId: ingredientId };
    if (sourceFilter) {
      where["source"] = sourceFilter;
    }
    if (feasibilityMin !== undefined) {
      where["feasibilityScore"] = { gte: feasibilityMin };
    }

    const orderBy: Record<string, string> = {};
    orderBy[sortBy ?? "createdAt"] = sortOrder;

    const totalSubstitutions = await prisma.substitutionOption.count({ where });

    const substitutions = await withTenant(tenantId, async () => {
      return prisma.substitutionOption.findMany({
        where,
        include: {
          substituteIngredient: {
            select: {
              id: true,
              name: true,
              category: true,
              casNumber: true,
              eenumber: true,
              allergenFlags: true,
              isSynthetic: true,
              sourceType: true,
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });
    });

    const totalPages = Math.ceil(totalSubstitutions / limit);

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        ingredientId,
        totalSubstitutions,
        page,
        limit,
        durationMs: Date.now() - requestStart,
        action: "ingredient_substitutions_list",
      },
      "Listed ingredient substitutions"
    );

    return NextResponse.json({
      substitutions: substitutions.map((sub) => ({
        id: sub.id,
        originalIngredientId: sub.originalIngredientId,
        substituteIngredientId: sub.substituteIngredientId,
        substitutionCost: sub.substitutionCost,
        feasibilityScore: sub.feasibilityScore,
        sensoryImpact: sub.sensoryImpact,
        shelfLifeImpact: sub.shelfLifeImpact,
        regulatoryRisk: sub.regulatoryRisk,
        notes: sub.notes,
        source: sub.source,
        createdAt: sub.createdAt,
        substituteIngredient: sub.substituteIngredient,
      })),
      pagination: {
        page,
        limit,
        totalItems: totalSubstitutions,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "ingredient_substitutions_list_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "ingredient_substitutions_list_error" }, "Unexpected error listing ingredient substitutions");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list substitution options" } },
      { status: 500 }
    );
  }
}

// POST /api/ingredients/[id]/substitutions — Create new substitution option
export async function POST(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: ingredientId } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can create substitution options
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to create substitution options", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    // Verify the original ingredient exists and belongs to the tenant
    const ingredient = await withTenant(tenantId, async () => {
      return prisma.ingredient.findFirst({
        where: { id: ingredientId, tenantId },
        select: { id: true, name: true },
      });
    });

    if (!ingredient) {
      throw new NotFoundError("Ingredient", ingredientId);
    }

    const body = await request.json();
    const validated = substitutionCreateSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const {
      substituteIngredientId,
      substitutionCost,
      feasibilityScore,
      sensoryImpact,
      shelfLifeImpact,
      regulatoryRisk,
      notes,
      source,
    } = validated.data;

    // Verify the substitute ingredient exists and belongs to the tenant
    const substituteIngredient = await withTenant(tenantId, async () => {
      return prisma.ingredient.findFirst({
        where: { id: substituteIngredientId, tenantId },
        select: { id: true, name: true },
      });
    });

    if (!substituteIngredient) {
      throw new NotFoundError("Substitute ingredient", substituteIngredientId);
    }

    // Prevent self-substitution
    if (substituteIngredientId === ingredientId) {
      throw new ValidationError([
        {
          field: "substituteIngredientId",
          message: "An ingredient cannot be a substitute for itself",
          value: substituteIngredientId,
        },
      ]);
    }

    // Check for duplicate substitution (same original + substitute pair)
    const existingSubstitution = await prisma.substitutionOption.findFirst({
      where: {
        originalIngredientId: ingredientId,
        substituteIngredientId,
      },
    });

    if (existingSubstitution) {
      throw new ConflictError(
        `A substitution option from "${ingredient.name}" to "${substituteIngredient.name}" already exists`,
        { originalIngredientId: ingredientId, substituteIngredientId, existingId: existingSubstitution.id }
      );
    }

    const substitution = await withTenant(tenantId, async () => {
      return prisma.substitutionOption.create({
        data: {
          tenantId,
          originalIngredientId: ingredientId,
          substituteIngredientId,
          substitutionCost: substitutionCost ?? undefined,
          feasibilityScore: feasibilityScore ?? undefined,
          sensoryImpact: sensoryImpact ?? undefined,
          shelfLifeImpact: shelfLifeImpact ?? undefined,
          regulatoryRisk: regulatoryRisk ?? undefined,
          notes: notes ?? undefined,
          source: source ?? undefined,
        },
        include: {
          substituteIngredient: {
            select: {
              id: true,
              name: true,
              category: true,
              casNumber: true,
              allergenFlags: true,
            },
          },
        },
      });
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "SUBSTITUTION_OPTION_CREATED",
        entityType: "SubstitutionOption",
        entityId: substitution.id,
        newValue: {
          originalIngredientId: ingredientId,
          originalIngredientName: ingredient.name,
          substituteIngredientId,
          substituteIngredientName: substituteIngredient.name,
          feasibilityScore,
          sensoryImpact,
          source,
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
        ingredientId,
        substitutionId: substitution.id,
        substituteIngredientId,
        durationMs: Date.now() - requestStart,
        action: "substitution_option_created",
      },
      "Substitution option created"
    );

    return NextResponse.json({ substitution }, { status: 201 });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "substitution_option_create_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "substitution_option_create_validation_failed" },
        "Substitution option creation validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "substitution_option_create_error" }, "Unexpected error creating substitution option");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create substitution option" } },
      { status: 500 }
    );
  }
}
