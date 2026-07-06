// Cascada — Products API Routes
// GET  /api/products — Paginated list with search, filter by category/brand/market/retailer
// POST /api/products — Create product with Zod validation

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth, canWrite } from "@/lib/auth";
import { paginationSchema, productCreateSchema } from "@/lib/validation";
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
function parseProductQueryFromUrl(url: string) {
  const { searchParams } = new URL(url);

  const pagination = paginationSchema.parse({
    page: searchParams.get("page") ?? "1",
    limit: searchParams.get("limit") ?? "20",
    sortBy: searchParams.get("sortBy") ?? "name",
    sortOrder: searchParams.get("sortOrder") ?? "asc",
  });

  const search = searchParams.get("search") ?? undefined;
  const category = searchParams.get("category") ?? undefined;
  const brand = searchParams.get("brand") ?? undefined;
  const market = searchParams.get("market") ?? undefined;
  const retailer = searchParams.get("retailer") ?? undefined;
  const isActive = searchParams.get("isActive") === "true" ? true : searchParams.get("isActive") === "false" ? false : undefined;
  const erpId = searchParams.get("erpId") ?? undefined;

  return { pagination, search, category, brand, market, retailer, isActive, erpId };
}

// GET /api/products — Paginated product list with search and filters
export async function GET(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    const { pagination, search, category, brand, market, retailer, isActive, erpId } =
      parseProductQueryFromUrl(request.url);
    const { page, limit, sortBy, sortOrder } = pagination;

    // Build the where clause
    const where: Record<string, unknown> = { tenantId };

    if (search) {
      where["OR"] = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
      ];
    }

    if (category) {
      where["category"] = category;
    }

    if (brand) {
      where["brand"] = brand;
    }

    if (market) {
      where["markets"] = { has: market };
    }

    if (retailer) {
      where["retailers"] = { has: retailer };
    }

    if (isActive !== undefined) {
      where["isActive"] = isActive;
    }

    if (erpId) {
      where["erpId"] = erpId;
    }

    // Build the orderBy clause
    const orderBy: Record<string, string> = {};
    orderBy[sortBy ?? "name"] = sortOrder;

    const totalProducts = await prisma.product.count({ where });

    const products = await withTenant(tenantId, async () => {
      return prisma.product.findMany({
        where,
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
          _count: {
            select: { formulations: true, customerProducts: true },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      });
    });

    const totalPages = Math.ceil(totalProducts / limit);

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.debug(
      {
        userId,
        role,
        page,
        limit,
        totalProducts,
        filters: { search, category, brand, market, retailer, isActive, erpId },
        durationMs: Date.now() - requestStart,
        action: "products_list",
      },
      "Listed products"
    );

    return NextResponse.json({
      products: products.map((p) => ({
        id: p.id,
        erpId: p.erpId,
        name: p.name,
        sku: p.sku,
        category: p.category,
        brand: p.brand,
        markets: p.markets,
        retailers: p.retailers,
        isActive: p.isActive,
        annualVolume: p.annualVolume,
        annualRevenue: p.annualRevenue,
        formulationCount: p._count.formulations,
        customerCount: p._count.customerProducts,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      pagination: {
        page,
        limit,
        totalItems: totalProducts,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "products_list_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "products_list_error" }, "Unexpected error listing products");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to list products" } },
      { status: 500 }
    );
  }
}

// POST /api/products — Create a new product
export async function POST(request: NextRequest) {
  const requestStart = Date.now();

  try {
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // RBAC check: only users with write permission can create products
    if (!canWrite(role)) {
      throw new AuthorizationError("Insufficient permissions to create products", {
        userId,
        role,
        requiredPermission: "canWrite",
      });
    }

    const body = await request.json();
    const validated = productCreateSchema.safeParse(body);

    if (!validated.success) {
      throw formatZodError(validated.error);
    }

    const { name, sku, erpId, category, brand, markets, retailers, annualVolume, annualRevenue } =
      validated.data;

    // Check for duplicate SKU within the tenant
    const existingProduct = await prisma.product.findFirst({
      where: { tenantId, sku },
    });

    if (existingProduct) {
      throw new ConflictError(`A product with SKU "${sku}" already exists in this tenant`, {
        sku,
        tenantId,
        existingId: existingProduct.id,
      });
    }

    const product = await withTenant(tenantId, async () => {
      return prisma.product.create({
        data: {
          tenantId,
          name,
          sku,
          erpId: erpId ?? null,
          category: category ?? null,
          brand: brand ?? null,
          markets,
          retailers,
          annualVolume: annualVolume ?? null,
          annualRevenue: annualRevenue ?? null,
        },
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
        action: "PRODUCT_CREATED",
        entityType: "Product",
        entityId: product.id,
        newValue: {
          name: product.name,
          sku: product.sku,
          category: product.category,
          brand: product.brand,
          markets: product.markets,
          retailers: product.retailers,
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
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        durationMs: Date.now() - requestStart,
        action: "product_created",
      },
      "Product created"
    );

    return NextResponse.json({ product }, { status: 201 });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "product_create_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      logger.warn(
        { err: validationError, durationMs, action: "product_create_validation_failed" },
        "Product creation validation failed"
      );
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "product_create_error" }, "Unexpected error creating product");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to create product" } },
      { status: 500 }
    );
  }
}
