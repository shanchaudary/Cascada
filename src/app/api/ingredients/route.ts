// Cascada — Ingredients API Routes
// GET  /api/ingredients — Paginated list with search/filter by category, allergen, supplier
// POST /api/ingredients — Create ingredient with Zod validation

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { paginationSchema, ingredientCreateSchema } from "@/lib/validation";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

/**
 * Extract and validate the current session + tenant context.
 * Returns userId, tenantId, and role, or throws on auth failure.
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
function parseIngredientQueryFromUrl(url: string) {
  const { searchParams } = new URL(url);

  const pagination = paginationSchema.parse({
    page: searchParams.get("page") ?? "1",
    limit: searchParams.get("limit") ?? "20",
    sortBy: searchParams.get("sortBy") ?? "name",
    sortOrder: searchParams.get("sortOrder") ?? "asc",
  });

  const search = searchParams.get("search") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const allergen = searchParams.get("allergen") ?? undefined;
  const supplier = searchParams.get("supplier") ?? undefined;
  const sourceType = searchParams.get("sourceType") ?? undefined;
  const isSynthetic = searchParams.get("isSynthetic") === "true" ? true : searchParams.get("isSynthetic") === "false" ? false : undefined;

  return { pagination, search, category, allergen, supplier, sourceType, isSynthetic };
}

// GET /api/ingredients — Paginated ingredient list with search and filters
export async function GET(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const { pagination, search, category, allergen, supplier, sourceType, isSynthetic } =
      parseIngredientQueryFromUrl(request.url);
    const { page, limit, sortBy, sortOrder } = pagination;

    // Build the where clause
    const where: Record<string, unknown> = { tenantId };

    if (search) {
      where["OR"] = [
        { name: { contains: search, mode: "insensitive" } },
        { casNumber: { contains: search, mode: "insensitive" } },
        { eenumber: { contains: search, mode: "insensitive" } },
        { alternateNames: { has: search } },
      ];
    }

    if (category) {
      where["category"] = category;
    }

    if (allergen) {
      where["allergenFlags"] = { has: allergen };
    }

    if (supplier) {
      where["supplierIds"] = { has: supplier };
    }

    if (sourceType) {
      where["sourceType"] = sourceType;
    }

    if (isSynthetic !== undefined) {
      where["isSynthetic"] = isSynthetic;
    }

    // Build the orderBy clause
    const orderBy: Record<string, string> = {};
    orderBy[sortBy ?? "name"] = sortOrder;

    const totalIngredients = await prisma.ingredient.count({ where });

    const ingredients = await withTenant(tenantId, async () => {
      return prisma.ingredient.findMany({
        where,
        select: {
          id: true,
          erpId: true,
          name: true,
          casNumber: true,
          eenumber: true,
          category: true,
          isSynthetic: true,
          sourceType: true,
          allergenFlags: true,
          supplierIds: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });
    });

    const totalPages = Math.ceil(totalIngredients / limit);

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        page,
        limit,
        totalIngredients,
        filters: { search, category, allergen, supplier, sourceType, isSynthetic },
        durationMs: Date.now() - requestStart,
        action: "ingredients_list",
      },
      "Listed ingredients"
    );

    return NextResponse.json({
      ingredients,
      pagination: {
        page,
        limit,
        totalItems: totalIngredients,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "ingredients_list_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "ingredients_list_validation_failed" },
        "Ingredients list validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "ingredients_list_error" }, "Unexpected error listing ingredients");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list ingredients" } },
      { status: 500 }
    );
  }
}

// POST /api/ingredients — Create a new ingredient
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can create ingredients
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to create ingredients", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    const body = await request.json();
    const validated = ingredientCreateSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { name, erpId, alternateNames, casNumber, eenumber, category, isSynthetic, sourceType, allergenFlags, supplierIds, metadata } =
      validated.data;

    // Check for duplicate ingredient name within the tenant
    const existingIngredient = await prisma.ingredient.findFirst({
      where: { tenantId, name },
    });

    if (existingIngredient) {
      throw new ConflictError(`An ingredient with name "${name}" already exists in this tenant`, {
        name,
        tenantId,
        existingId: existingIngredient.id,
      });
    }

    const ingredient = await withTenant(tenantId, async () => {
      return prisma.ingredient.create({
        data: {
          tenantId,
          name,
          erpId: erpId ?? null,
          alternateNames,
          casNumber: casNumber ?? null,
          eenumber: eenumber ?? null,
          category: category ?? null,
          isSynthetic: isSynthetic ?? null,
          sourceType: sourceType ?? null,
          allergenFlags,
          supplierIds,
          metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
        },
        select: {
          id: true,
          erpId: true,
          name: true,
          alternateNames: true,
          casNumber: true,
          eenumber: true,
          category: true,
          isSynthetic: true,
          sourceType: true,
          allergenFlags: true,
          supplierIds: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "INGREDIENT_CREATED",
        entityType: "Ingredient",
        entityId: ingredient.id,
        newValue: { name, category, casNumber, eenumber },
        ipAddress: request.headers.get("x-forwarded-for") ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      },
    });

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.info(
      {
        userId,
        role,
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        durationMs: Date.now() - requestStart,
        action: "ingredient_created",
      },
      "Ingredient created"
    );

    return NextResponse.json({ ingredient }, { status: 201 });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "ingredient_create_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "ingredient_create_validation_failed" },
        "Ingredient creation validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "ingredient_create_error" }, "Unexpected error creating ingredient");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create ingredient" } },
      { status: 500 }
    );
  }
}
