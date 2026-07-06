// Cascada — ERP Connections API Routes
// GET: List all ERP connections for a tenant
// POST: Create a new ERP connection

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger from "@/lib/logger";
import { ErpConnectionError } from "@/lib/errors";
import { erpConnectionCreateSchema } from "@/lib/validation";
import { getSupportedErpTypes } from "@/lib/erp";

// GET /api/erp-connections — List all ERP connections
export async function GET(request: NextRequest) {
  try {
    // TODO: Extract tenantId from auth context (Stage 8)
    const tenantId = request.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant context required" },
        { status: 400 }
      );
    }

    const connections = await withTenant(tenantId, async () => {
      return prisma.erpConnection.findMany({
        where: { tenantId },
        select: {
          id: true,
          erpType: true,
          connectionName: true,
          syncStatus: true,
          lastSyncAt: true,
          lastSyncError: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
    });

    logger.info({ tenantId, count: connections.length }, "Listed ERP connections");

    return NextResponse.json({
      connections,
      supportedTypes: getSupportedErpTypes(),
    });
  } catch (error) {
    logger.error({ error }, "Failed to list ERP connections");
    return NextResponse.json(
      { error: "Failed to list ERP connections" },
      { status: 500 }
    );
  }
}

// POST /api/erp-connections — Create a new ERP connection
export async function POST(request: NextRequest) {
  try {
    const tenantId = request.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant context required" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validated = erpConnectionCreateSchema.parse(body);

    // Check plan limits
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true },
    });

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const existingConnections = await prisma.erpConnection.count({
      where: { tenantId },
    });

    const { PLAN_FEATURES } = await import("@/lib/constants");
    const planFeatures = PLAN_FEATURES[tenant.plan as keyof typeof PLAN_FEATURES];
    if (planFeatures && existingConnections >= planFeatures.maxErpConnections) {
      return NextResponse.json(
        {
          error: `Maximum ERP connections reached for ${tenant.plan} plan (${planFeatures.maxErpConnections})`,
          currentCount: existingConnections,
          maxAllowed: planFeatures.maxErpConnections,
        },
        { status: 403 }
      );
    }

    const connection = await prisma.erpConnection.create({
      data: {
        tenantId,
        erpType: validated.erpType,
        connectionName: validated.connectionName,
        connectionString: validated.connectionString,
        authConfig: validated.authConfig as any,
        fieldMappings: (validated.fieldMappings ?? {
          ingredient: [],
          formulation: [],
          product: [],
          customer: [],
          supplier: [],
        }) as any,
        syncStatus: "DISCONNECTED",
        syncState: {},
      },
    });

    logger.info(
      { tenantId, connectionId: connection.id, erpType: validated.erpType },
      "Created ERP connection"
    );

    return NextResponse.json(
      {
        connection: {
          id: connection.id,
          erpType: connection.erpType,
          connectionName: connection.connectionName,
          syncStatus: connection.syncStatus,
          createdAt: connection.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error({ error }, "Failed to create ERP connection");
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json(
        { error: "Validation failed", details: (error as unknown as { errors: unknown[] }).errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create ERP connection" },
      { status: 500 }
    );
  }
}
