// Cascada — Ingredient Detail API Routes
// GET    /api/ingredients/[id] — Single ingredient with formulation usage
// PATCH  /api/ingredients/[id] — Update ingredient fields

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { ingredientUpdateSchema } from "@/lib/validation";
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

// GET /api/ingredients/[id] — Single ingredient with formulation usage
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const ingredient = await withTenant(tenantId, async () => {
      return prisma.ingredient.findFirst({
        where: { id, tenantId },
        include: {
          formulationItems: {
            select: {
              id: true,
              formulationId: true,
              quantity: true,
              unit: true,
              percentage: true,
              isAlternate: true,
              sortOrder: true,
              formulation: {
                select: {
                  id: true,
                  name: true,
                  version: true,
                  status: true,
                },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
          ruleSubstances: {
            select: {
              id: true,
              substanceName: true,
              substanceType: true,
              isMatched: true,
              matchConfidence: true,
              matchMethod: true,
              rule: {
                select: {
                  id: true,
                  jurisdiction: true,
                  ruleType: true,
                  description: true,
                  effectiveDate: true,
                  complianceDate: true,
                },
              },
            },
          },
          substitutionOptions: {
            select: {
              id: true,
              substituteIngredientId: true,
              substitutionCost: true,
              feasibilityScore: true,
              sensoryImpact: true,
              shelfLifeImpact: true,
              regulatoryRisk: true,
              source: true,
              substituteIngredient: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  casNumber: true,
                },
              },
            },
          },
          substituteOptionsFor: {
            select: {
              id: true,
              originalIngredientId: true,
              substitutionCost: true,
              feasibilityScore: true,
              sensoryImpact: true,
              source: true,
              originalIngredient: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                },
              },
            },
          },
        },
      });
    });

    if (!ingredient) {
      throw new NotFoundError("Ingredient", id);
    }

    // Compute formulation usage summary
    const formulationUsage = ingredient.formulationItems.map((item) => ({
      formulationItemId: item.id,
      formulationId: item.formulationId,
      formulationName: item.formulation.name,
      formulationVersion: item.formulation.version,
      formulationStatus: item.formulation.status,
      quantity: item.quantity,
      unit: item.unit,
      percentage: item.percentage,
      isAlternate: item.isAlternate,
    }));

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        ingredientId: id,
        formulationCount: formulationUsage.length,
        ruleSubstanceCount: ingredient.ruleSubstances.length,
        durationMs: Date.now() - requestStart,
        action: "ingredient_detail",
      },
      "Retrieved ingredient detail"
    );

    return NextResponse.json({
      ingredient: {
        id: ingredient.id,
        erpId: ingredient.erpId,
        name: ingredient.name,
        alternateNames: ingredient.alternateNames,
        casNumber: ingredient.casNumber,
        eenumber: ingredient.eenumber,
        category: ingredient.category,
        isSynthetic: ingredient.isSynthetic,
        sourceType: ingredient.sourceType,
        allergenFlags: ingredient.allergenFlags,
        supplierIds: ingredient.supplierIds,
        metadata: ingredient.metadata,
        createdAt: ingredient.createdAt,
        updatedAt: ingredient.updatedAt,
        formulationUsage,
        regulatoryMatches: ingredient.ruleSubstances,
        substitutionOptions: ingredient.substitutionOptions,
        substituteOptionsFor: ingredient.substituteOptionsFor,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "ingredient_detail_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "ingredient_detail_error" }, "Unexpected error retrieving ingredient");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve ingredient" } },
      { status: 500 }
    );
  }
}

// PATCH /api/ingredients/[id] — Update ingredient fields
export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can update ingredients
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to update ingredients", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    const body = await request.json();
    const validated = ingredientUpdateSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    // Verify the ingredient exists and belongs to the tenant
    const existing = await withTenant(tenantId, async () => {
      return prisma.ingredient.findFirst({
        where: { id, tenantId },
      });
    });

    if (!existing) {
      throw new NotFoundError("Ingredient", id);
    }

    // If name is being updated, check for duplicates within the tenant
    if (validated.data.name && validated.data.name !== existing.name) {
      const duplicate = await prisma.ingredient.findFirst({
        where: { tenantId, name: validated.data.name, id: { not: id } },
      });

      if (duplicate) {
        throw new ConflictError(`An ingredient with name "${validated.data.name}" already exists in this tenant`, {
          name: validated.data.name,
          tenantId,
          existingId: duplicate.id,
        });
      }
    }

    // Build update data, only including fields that were provided
    const updateData: Record<string, unknown> = {};
    if (validated.data.erpId !== undefined) updateData["erpId"] = validated.data.erpId;
    if (validated.data.name !== undefined) updateData["name"] = validated.data.name;
    if (validated.data.alternateNames !== undefined) updateData["alternateNames"] = validated.data.alternateNames;
    if (validated.data.casNumber !== undefined) updateData["casNumber"] = validated.data.casNumber;
    if (validated.data.eenumber !== undefined) updateData["eenumber"] = validated.data.eenumber;
    if (validated.data.category !== undefined) updateData["category"] = validated.data.category;
    if (validated.data.isSynthetic !== undefined) updateData["isSynthetic"] = validated.data.isSynthetic;
    if (validated.data.sourceType !== undefined) updateData["sourceType"] = validated.data.sourceType;
    if (validated.data.allergenFlags !== undefined) updateData["allergenFlags"] = validated.data.allergenFlags;
    if (validated.data.supplierIds !== undefined) updateData["supplierIds"] = validated.data.supplierIds;
    if (validated.data.metadata !== undefined) updateData["metadata"] = validated.data.metadata;

    const updatedIngredient = await withTenant(tenantId, async () => {
      return prisma.ingredient.update({
        where: { id },
        data: updateData,
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
        action: "INGREDIENT_UPDATED",
        entityType: "Ingredient",
        entityId: id,
        oldValue: {
          name: existing.name,
          category: existing.category,
          casNumber: existing.casNumber,
          allergenFlags: existing.allergenFlags,
        },
        newValue: {
          name: updatedIngredient.name,
          category: updatedIngredient.category,
          casNumber: updatedIngredient.casNumber,
          allergenFlags: updatedIngredient.allergenFlags,
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
        ingredientId: id,
        updatedFields: Object.keys(updateData),
        durationMs: Date.now() - requestStart,
        action: "ingredient_updated",
      },
      "Ingredient updated"
    );

    return NextResponse.json({ ingredient: updatedIngredient });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "ingredient_update_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "ingredient_update_validation_failed" },
        "Ingredient update validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "ingredient_update_error" }, "Unexpected error updating ingredient");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update ingredient" } },
      { status: 500 }
    );
  }
}
