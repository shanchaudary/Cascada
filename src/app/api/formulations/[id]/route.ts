// Cascada — Formulation Detail API Routes
// GET   /api/formulations/[id] — Single formulation with items + ingredient details
// PATCH /api/formulations/[id] — Update formulation metadata

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { z, ZodError } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  CascadaError,
  toError,
} from "@/lib/errors";

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
 * Zod schema for updating formulation metadata.
 * Only metadata fields can be updated — items are managed via /items endpoint.
 */
const formulationUpdateSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED", "UNDER_REVIEW"]).optional(),
  batchSize: z.number().positive().optional(),
  batchSizeUnit: z.string().optional(),
  totalCost: z.number().positive().optional(),
});

// GET /api/formulations/[id] — Single formulation with items + ingredient details
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const formulation = await withTenant(tenantId, async () => {
      return prisma.formulation.findFirst({
        where: { id, tenantId },
        include: {
          items: {
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
            orderBy: { sortOrder: "asc" },
          },
          products: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  category: true,
                  brand: true,
                  isActive: true,
                },
              },
            },
          },
        },
      });
    });

    if (!formulation) {
      throw new NotFoundError("Formulation", id);
    }

    // Compute aggregated data for the response
    const ingredientCount = formulation.items.length;
    const allergenSet = new Set<string>();
    const categoriesSet = new Set<string>();

    for (const item of formulation.items) {
      if (item.ingredient.category) {
        categoriesSet.add(item.ingredient.category);
      }
      for (const flag of item.ingredient.allergenFlags) {
        allergenSet.add(flag);
      }
    }

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        formulationId: id,
        ingredientCount,
        productCount: formulation.products.length,
        durationMs: Date.now() - requestStart,
        action: "formulation_detail",
      },
      "Retrieved formulation detail"
    );

    return NextResponse.json({
      formulation: {
        id: formulation.id,
        erpId: formulation.erpId,
        name: formulation.name,
        description: formulation.description,
        version: formulation.version,
        status: formulation.status,
        batchSize: formulation.batchSize,
        batchSizeUnit: formulation.batchSizeUnit,
        totalCost: formulation.totalCost,
        createdAt: formulation.createdAt,
        updatedAt: formulation.updatedAt,
        items: formulation.items.map((item) => ({
          id: item.id,
          ingredientId: item.ingredientId,
          quantity: item.quantity,
          unit: item.unit,
          percentage: item.percentage,
          isAlternate: item.isAlternate,
          replacesIngredientId: item.replacesIngredientId,
          sortOrder: item.sortOrder,
          ingredient: item.ingredient,
        })),
        products: formulation.products.map((pf) => ({
          id: pf.id,
          isCurrent: pf.isCurrent,
          effectiveDate: pf.effectiveDate,
          product: pf.product,
        })),
        summary: {
          ingredientCount,
          allergenFlags: Array.from(allergenSet),
          ingredientCategories: Array.from(categoriesSet),
          productCount: formulation.products.length,
        },
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "formulation_detail_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "formulation_detail_error" }, "Unexpected error retrieving formulation");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve formulation" } },
      { status: 500 }
    );
  }
}

// PATCH /api/formulations/[id] — Update formulation metadata
export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can update formulations
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to update formulations", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    const body = await request.json();
    const validated = formulationUpdateSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    // Verify the formulation exists and belongs to the tenant
    const existing = await withTenant(tenantId, async () => {
      return prisma.formulation.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          name: true,
          status: true,
          version: true,
        },
      });
    });

    if (!existing) {
      throw new NotFoundError("Formulation", id);
    }

    // Business rule: status transitions must be valid
    if (validated.data.status) {
      const validTransitions: Record<string, string[]> = {
        DRAFT: ["ACTIVE", "UNDER_REVIEW", "ARCHIVED"],
        UNDER_REVIEW: ["DRAFT", "ACTIVE", "ARCHIVED"],
        ACTIVE: ["ARCHIVED", "UNDER_REVIEW"],
        ARCHIVED: ["DRAFT"],
      };

      const allowedNext = validTransitions[existing.status];
      if (!allowedNext || !allowedNext.includes(validated.data.status)) {
        throw new ValidationError([
          {
            field: "status",
            message: `Cannot transition formulation from ${existing.status} to ${validated.data.status}`,
            value: validated.data.status,
          },
        ]);
      }
    }

    // Build update data, only including fields that were provided
    const updateData: Record<string, unknown> = {};
    if (validated.data.name !== undefined) updateData["name"] = validated.data.name;
    if (validated.data.description !== undefined) updateData["description"] = validated.data.description;
    if (validated.data.status !== undefined) updateData["status"] = validated.data.status;
    if (validated.data.batchSize !== undefined) updateData["batchSize"] = validated.data.batchSize;
    if (validated.data.batchSizeUnit !== undefined) updateData["batchSizeUnit"] = validated.data.batchSizeUnit;
    if (validated.data.totalCost !== undefined) updateData["totalCost"] = validated.data.totalCost;

    const updatedFormulation = await withTenant(tenantId, async () => {
      return prisma.formulation.update({
        where: { id },
        data: updateData,
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
        },
      });
    });

    // Create audit log entry
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: "FORMULATION_UPDATED",
        entityType: "Formulation",
        entityId: id,
        oldValue: {
          name: existing.name,
          status: existing.status,
        },
        newValue: {
          name: updatedFormulation.name,
          status: updatedFormulation.status,
          updatedFields: Object.keys(updateData),
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
        formulationId: id,
        updatedFields: Object.keys(updateData),
        durationMs: Date.now() - requestStart,
        action: "formulation_updated",
      },
      "Formulation updated"
    );

    return NextResponse.json({ formulation: updatedFormulation });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "formulation_update_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "formulation_update_validation_failed" },
        "Formulation update validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "formulation_update_error" }, "Unexpected error updating formulation");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update formulation" } },
      { status: 500 }
    );
  }
}
