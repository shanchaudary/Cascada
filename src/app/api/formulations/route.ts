// Cascada — Formulations API Routes
// GET  /api/formulations — Paginated list with filter by status, version
// POST /api/formulations — Create formulation with items

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import {
  paginationSchema,
  formulationCreateSchema,
  formulationItemCreateSchema,
} from "@/lib/validation";
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
function parseFormulationQueryFromUrl(url: string) {
  const { searchParams } = new URL(url);

  const pagination = paginationSchema.parse({
    page: searchParams.get("page") ?? "1",
    limit: searchParams.get("limit") ?? "20",
    sortBy: searchParams.get("sortBy") ?? "createdAt",
    sortOrder: searchParams.get("sortOrder") ?? "desc",
  });

  const status = searchParams.get("status") ?? undefined;
  const version = searchParams.get("version")
    ? Number(searchParams.get("version"))
    : undefined;
  const search = searchParams.get("search") ?? undefined;
  const erpId = searchParams.get("erpId") ?? undefined;

  return { pagination, status, version, search, erpId };
}

// GET /api/formulations — Paginated formulation list with filters
export async function GET(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const { pagination, status, version, search, erpId } =
      parseFormulationQueryFromUrl(request.url);
    const { page, limit, sortBy, sortOrder } = pagination;

    // Build the where clause
    const where: Record<string, unknown> = { tenantId };

    if (status) {
      where["status"] = status;
    }

    if (version !== undefined) {
      where["version"] = version;
    }

    if (search) {
      where["OR"] = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (erpId) {
      where["erpId"] = erpId;
    }

    // Build the orderBy clause
    const orderBy: Record<string, string> = {};
    orderBy[sortBy ?? "createdAt"] = sortOrder;

    const totalFormulations = await prisma.formulation.count({ where });

    const formulations = await withTenant(tenantId, async () => {
      return prisma.formulation.findMany({
        where,
        select: {
          id: true,
          erpId: true,
          name: true,
          description: true,
          version: true,
          status: true,
          batchSize: true,
          batchSizeUnit: true,
          totalCost: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { items: true, products: true },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });
    });

    const totalPages = Math.ceil(totalFormulations / limit);

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        page,
        limit,
        totalFormulations,
        filters: { status, version, search, erpId },
        durationMs: Date.now() - requestStart,
        action: "formulations_list",
      },
      "Listed formulations"
    );

    return NextResponse.json({
      formulations: formulations.map((f) => ({
        id: f.id,
        erpId: f.erpId,
        name: f.name,
        description: f.description,
        version: f.version,
        status: f.status,
        batchSize: f.batchSize,
        batchSizeUnit: f.batchSizeUnit,
        totalCost: f.totalCost,
        itemCount: f._count.items,
        productCount: f._count.products,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
      pagination: {
        page,
        limit,
        totalItems: totalFormulations,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "formulations_list_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "formulations_list_error" }, "Unexpected error listing formulations");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list formulations" } },
      { status: 500 }
    );
  }
}

// POST /api/formulations — Create a new formulation with items
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can create formulations
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to create formulations", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    const body = await request.json();

    // Validate the formulation metadata
    const formulationValidated = formulationCreateSchema.safeParse(body);
    if (!formulationValidated.success) {
      throw formatZodError(formulationValidated.error);
    }

    // Validate items array if provided
    const rawItems: unknown[] = Array.isArray(body["items"]) ? body["items"] : [];
    const validatedItems = formulationItemCreateSchema.array().safeParse(rawItems);
    if (!validatedItems.success) {
      throw formatZodError(validatedItems.error);
    }

    const { name, erpId, description, batchSize, batchSizeUnit } = formulationValidated.data;
    const items = validatedItems.data;

    // Check for duplicate formulation name+erpId+version within tenant
    if (erpId) {
      const existingFormulation = await prisma.formulation.findFirst({
        where: { tenantId, erpId, version: 1 },
      });

      if (existingFormulation) {
        throw new ConflictError(
          `A formulation with ERP ID "${erpId}" version 1 already exists in this tenant`,
          { erpId, tenantId, existingId: existingFormulation.id }
        );
      }
    }

    // Verify all ingredient IDs in items exist within the tenant
    if (items.length > 0) {
      const ingredientIds = items.map((item) => item.ingredientId);
      const existingIngredients = await prisma.ingredient.findMany({
        where: { id: { in: ingredientIds }, tenantId },
        select: { id: true },
      });
      const existingIds = new Set(existingIngredients.map((i) => i.id));
      const missingIds = ingredientIds.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        throw new ValidationError(
          missingIds.map((id) => ({
            field: "items.ingredientId",
            message: `Ingredient with id "${id}" not found in this tenant`,
            value: id,
          })),
          "One or more ingredients not found"
        );
      }
    }

    // Create the formulation with its items in a transaction
    const formulation = await withTenant(tenantId, async () => {
      return prisma.formulation.create({
        data: {
          tenantId,
          name,
          erpId: erpId ?? null,
          description: description ?? null,
          version: 1,
          status: "DRAFT",
          batchSize: batchSize ?? null,
          batchSizeUnit: batchSizeUnit ?? null,
          items: {
            create: items.map((item) => ({
              ingredientId: item.ingredientId,
              quantity: item.quantity,
              unit: item.unit,
              percentage: item.percentage ?? null,
              isAlternate: item.isAlternate,
              replacesIngredientId: item.replacesIngredientId ?? null,
              sortOrder: item.sortOrder,
            })),
          },
        },
        include: {
          items: {
            include: {
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  casNumber: true,
                },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "FORMULATION_CREATED",
        entityType: "Formulation",
        entityId: formulation.id,
        newValue: {
          name: formulation.name,
          version: formulation.version,
          itemCount: items.length,
          batchSize: formulation.batchSize,
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
        formulationId: formulation.id,
        formulationName: formulation.name,
        itemCount: items.length,
        durationMs: Date.now() - requestStart,
        action: "formulation_created",
      },
      "Formulation created"
    );

    return NextResponse.json({ formulation }, { status: 201 });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "formulation_create_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "formulation_create_validation_failed" },
        "Formulation creation validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "formulation_create_error" }, "Unexpected error creating formulation");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create formulation" } },
      { status: 500 }
    );
  }
}
