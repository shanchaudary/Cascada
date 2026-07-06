// Cascada — Product Detail API Routes
// GET   /api/products/[id] — Single product with current formulation
// PATCH /api/products/[id] — Update product fields

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { productUpdateSchema } from "@/lib/validation";
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

// GET /api/products/[id] — Single product with current formulation
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const product = await withTenant(tenantId, async () => {
      return prisma.product.findFirst({
        where: { id, tenantId },
        include: {
          formulations: {
            where: { isCurrent: true },
            include: {
              formulation: {
                select: {
                  id: true,
                  name: true,
                  version: true,
                  status: true,
                  batchSize: true,
                  batchSizeUnit: true,
                  totalCost: true,
                  description: true,
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
                        },
                      },
                    },
                    orderBy: { sortOrder: "asc" },
                  },
                },
              },
            },
          },
          customerProducts: {
            where: { isActive: true },
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                  type: true,
                  requirements: true,
                },
              },
            },
          },
        },
      });
    });

    if (!product) {
      throw new NotFoundError("Product", id);
    }

    // Extract current formulation (the latest isCurrent=true link)
    const currentFormulationLink = product.formulations.find((pf) => pf.isCurrent);
    const currentFormulation = currentFormulationLink?.formulation ?? null;

    // Compute product summary
    const allergenSet = new Set<string>();
    const ingredientCategories = new Set<string>();

    if (currentFormulation) {
      for (const item of currentFormulation.items) {
        if (item.ingredient.category) {
          ingredientCategories.add(item.ingredient.category);
        }
        for (const flag of item.ingredient.allergenFlags) {
          allergenSet.add(flag);
        }
      }
    }

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        productId: id,
        hasCurrentFormulation: currentFormulation !== null,
        formulationItemCount: currentFormulation?.items.length ?? 0,
        customerCount: product.customerProducts.length,
        durationMs: Date.now() - requestStart,
        action: "product_detail",
      },
      "Retrieved product detail"
    );

    return NextResponse.json({
      product: {
        id: product.id,
        erpId: product.erpId,
        name: product.name,
        sku: product.sku,
        category: product.category,
        brand: product.brand,
        markets: product.markets,
        retailers: product.retailers,
        isActive: product.isActive,
        annualVolume: product.annualVolume,
        annualRevenue: product.annualRevenue,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        currentFormulation: currentFormulation
          ? {
              productFormulationId: currentFormulationLink!.id,
              effectiveDate: currentFormulationLink!.effectiveDate,
              formulation: {
                id: currentFormulation.id,
                name: currentFormulation.name,
                version: currentFormulation.version,
                status: currentFormulation.status,
                description: currentFormulation.description,
                batchSize: currentFormulation.batchSize,
                batchSizeUnit: currentFormulation.batchSizeUnit,
                totalCost: currentFormulation.totalCost,
                items: currentFormulation.items.map((item) => ({
                  id: item.id,
                  ingredientId: item.ingredientId,
                  quantity: item.quantity,
                  unit: item.unit,
                  percentage: item.percentage,
                  isAlternate: item.isAlternate,
                  sortOrder: item.sortOrder,
                  ingredient: item.ingredient,
                })),
              },
            }
          : null,
        customers: product.customerProducts.map((cp) => ({
          id: cp.id,
          specVersion: cp.specVersion,
          specRequirements: cp.specRequirements,
          customer: cp.customer,
        })),
        summary: {
          allergenFlags: Array.from(allergenSet),
          ingredientCategories: Array.from(ingredientCategories),
          ingredientCount: currentFormulation?.items.length ?? 0,
          customerCount: product.customerProducts.length,
          marketCount: product.markets.length,
          retailerCount: product.retailers.length,
        },
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "product_detail_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "product_detail_error" }, "Unexpected error retrieving product");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve product" } },
      { status: 500 }
    );
  }
}

// PATCH /api/products/[id] — Update product fields
export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can update products
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to update products", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    const body = await request.json();
    const validated = productUpdateSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    // Verify the product exists and belongs to the tenant
    const existing = await withTenant(tenantId, async () => {
      return prisma.product.findFirst({
        where: { id, tenantId },
      });
    });

    if (!existing) {
      throw new NotFoundError("Product", id);
    }

    // If SKU is being updated, check for duplicates within the tenant
    if (validated.data.sku && validated.data.sku !== existing.sku) {
      const duplicate = await prisma.product.findFirst({
        where: { tenantId, sku: validated.data.sku, id: { not: id } },
      });

      if (duplicate) {
        throw new ConflictError(`A product with SKU "${validated.data.sku}" already exists in this tenant`, {
          sku: validated.data.sku,
          tenantId,
          existingId: duplicate.id,
        });
      }
    }

    // Build update data, only including fields that were provided
    const updateData: Record<string, unknown> = {};
    if (validated.data.erpId !== undefined) updateData["erpId"] = validated.data.erpId;
    if (validated.data.name !== undefined) updateData["name"] = validated.data.name;
    if (validated.data.sku !== undefined) updateData["sku"] = validated.data.sku;
    if (validated.data.category !== undefined) updateData["category"] = validated.data.category;
    if (validated.data.brand !== undefined) updateData["brand"] = validated.data.brand;
    if (validated.data.markets !== undefined) updateData["markets"] = validated.data.markets;
    if (validated.data.retailers !== undefined) updateData["retailers"] = validated.data.retailers;
    if (validated.data.annualVolume !== undefined) updateData["annualVolume"] = validated.data.annualVolume;
    if (validated.data.annualRevenue !== undefined) updateData["annualRevenue"] = validated.data.annualRevenue;

    const updatedProduct = await withTenant(tenantId, async () => {
      return prisma.product.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          erpId: true,
          name: true,
          sku: true,
          category: true,
          brand: true,
          markets: true,
          retailers: true,
          isActive: true,
          annualVolume: true,
          annualRevenue: true,
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
        action: "PRODUCT_UPDATED",
        entityType: "Product",
        entityId: id,
        oldValue: {
          name: existing.name,
          sku: existing.sku,
          category: existing.category,
          brand: existing.brand,
        },
        newValue: {
          name: updatedProduct.name,
          sku: updatedProduct.sku,
          category: updatedProduct.category,
          brand: updatedProduct.brand,
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
        productId: id,
        updatedFields: Object.keys(updateData),
        durationMs: Date.now() - requestStart,
        action: "product_updated",
      },
      "Product updated"
    );

    return NextResponse.json({ product: updatedProduct });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "product_update_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "product_update_validation_failed" },
        "Product update validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "product_update_error" }, "Unexpected error updating product");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to update product" } },
      { status: 500 }
    );
  }
}
