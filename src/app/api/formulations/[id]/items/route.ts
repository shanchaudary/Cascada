// Cascada — Formulation Items API Routes
// GET  /api/formulations/[id]/items — List formulation items with ingredient details
// POST /api/formulations/[id]/items — Add item to formulation

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { formulationItemCreateSchema, paginationSchema } from "@/lib/validation";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  ValidationError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

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

// GET /api/formulations/[id]/items — List formulation items with ingredient details
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: formulationId } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // Verify the formulation exists and belongs to the tenant
    const formulation = await withTenant(tenantId, async () => {
      return prisma.formulation.findFirst({
        where: { id: formulationId, tenantId },
        select: { id: true, name: true, version: true, status: true },
      });
    });

    if (!formulation) {
      throw new NotFoundError("Formulation", formulationId);
    }

    // Parse pagination from query string
    const { searchParams } = new URL(request.url);
    const pagination = paginationSchema.parse({
      page: searchParams.get("page") ?? "1",
      limit: searchParams.get("limit") ?? "50",
      sortBy: searchParams.get("sortBy") ?? "sortOrder",
      sortOrder: searchParams.get("sortOrder") ?? "asc",
    });

    const { page, limit, sortBy, sortOrder } = pagination;

    // Optional filters
    const isAlternate = searchParams.get("isAlternate") === "true" ? true : undefined;
    const ingredientId = searchParams.get("ingredientId") ?? undefined;

    const where: Record<string, unknown> = { formulationId };
    if (isAlternate !== undefined) {
      where["isAlternate"] = isAlternate;
    }
    if (ingredientId) {
      where["ingredientId"] = ingredientId;
    }

    const orderBy: Record<string, string> = {};
    orderBy[sortBy ?? "sortOrder"] = sortOrder;

    const totalItems = await prisma.formulationItem.count({ where });

    const items = await withTenant(tenantId, async () => {
      return prisma.formulationItem.findMany({
        where,
        include: {
          ingredient: {
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

    const totalPages = Math.ceil(totalItems / limit);

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        formulationId,
        totalItems,
        page,
        limit,
        durationMs: Date.now() - requestStart,
        action: "formulation_items_list",
      },
      "Listed formulation items"
    );

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        formulationId: item.formulationId,
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        unit: item.unit,
        percentage: item.percentage,
        isAlternate: item.isAlternate,
        replacesIngredientId: item.replacesIngredientId,
        sortOrder: item.sortOrder,
        ingredient: item.ingredient,
      })),
      formulation: {
        id: formulation.id,
        name: formulation.name,
        version: formulation.version,
        status: formulation.status,
      },
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "formulation_items_list_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "formulation_items_list_error" }, "Unexpected error listing formulation items");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list formulation items" } },
      { status: 500 }
    );
  }
}

// POST /api/formulations/[id]/items — Add item to formulation
export async function POST(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: formulationId } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can add formulation items
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to add formulation items", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    // Verify the formulation exists, belongs to the tenant, and is in a mutable state
    const formulation = await withTenant(tenantId, async () => {
      return prisma.formulation.findFirst({
        where: { id: formulationId, tenantId },
        select: { id: true, name: true, status: true, version: true },
      });
    });

    if (!formulation) {
      throw new NotFoundError("Formulation", formulationId);
    }

    // Business rule: items can only be added to DRAFT or UNDER_REVIEW formulations
    if (formulation.status !== "DRAFT" && formulation.status !== "UNDER_REVIEW") {
      throw new ValidationError([
        {
          field: "formulationId",
          message: `Cannot add items to a formulation in ${formulation.status} status. Only DRAFT or UNDER_REVIEW formulations accept new items.`,
          value: formulation.status,
        },
      ]);
    }

    const body = await request.json();
    const validated = formulationItemCreateSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { ingredientId, quantity, unit, percentage, isAlternate, replacesIngredientId, sortOrder } =
      validated.data;

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

    // Check for duplicate ingredient in this formulation (prevent same ingredient appearing twice as non-alternate)
    const existingItem = await prisma.formulationItem.findFirst({
      where: {
        formulationId,
        ingredientId,
        isAlternate: false,
      },
    });

    if (existingItem && !isAlternate) {
      throw new ConflictError(
        `Ingredient "${ingredient.name}" already exists in this formulation as a primary ingredient`,
        { formulationId, ingredientId, existingItemId: existingItem.id }
      );
    }

    // If replacesIngredientId is provided, verify that ingredient exists in the formulation
    if (replacesIngredientId) {
      const replacedItem = await prisma.formulationItem.findFirst({
        where: { formulationId, ingredientId: replacesIngredientId },
      });

      if (!replacedItem) {
        throw new ValidationError([
          {
            field: "replacesIngredientId",
            message: `Ingredient "${replacesIngredientId}" is not part of this formulation`,
            value: replacesIngredientId,
          },
        ]);
      }
    }

    const newItem = await withTenant(tenantId, async () => {
      return prisma.formulationItem.create({
        data: {
          formulationId,
          ingredientId,
          quantity,
          unit,
          percentage: percentage ?? null,
          isAlternate,
          replacesIngredientId: replacesIngredientId ?? null,
          sortOrder,
        },
        include: {
          ingredient: {
            select: {
              id: true,
              name: true,
              category: true,
              casNumber: true,
              eenumber: true,
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
        action: "FORMULATION_ITEM_ADDED",
        entityType: "FormulationItem",
        entityId: newItem.id,
        newValue: {
          formulationId,
          formulationName: formulation.name,
          ingredientId,
          ingredientName: ingredient.name,
          quantity,
          unit,
          percentage,
          isAlternate,
          sortOrder,
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
        formulationId,
        itemId: newItem.id,
        ingredientId,
        ingredientName: ingredient.name,
        durationMs: Date.now() - requestStart,
        action: "formulation_item_added",
      },
      "Formulation item added"
    );

    return NextResponse.json({ item: newItem }, { status: 201 });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "formulation_item_add_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "formulation_item_add_validation_failed" },
        "Formulation item addition validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "formulation_item_add_error" }, "Unexpected error adding formulation item");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to add formulation item" } },
      { status: 500 }
    );
  }
}
