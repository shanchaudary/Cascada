// Cascada — ERP Connection Detail API Routes
// GET: Get a single ERP connection with details
// PATCH: Update an ERP connection
// DELETE: Delete an ERP connection

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger from "@/lib/logger";
import { erpConnectionUpdateSchema } from "@/lib/validation";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/erp-connections/[id]
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const tenantId = request.headers.get("x-tenant-id");

    const connection = await prisma.erpConnection.findFirst({
      where: { id, tenantId: tenantId ?? undefined },
      include: {
        syncLogs: {
          orderBy: { startedAt: "desc" },
          take: 10,
        },
      },
    });

    if (!connection) {
      return NextResponse.json(
        { error: "ERP connection not found" },
        { status: 404 }
      );
    }

    // Mask sensitive auth config fields
    const safeConnection = {
      ...connection,
      connectionString: "***MASKED***",
      authConfig: Object.keys(connection.authConfig as Record<string, unknown>).reduce(
        (acc, key) => {
          acc[key] = "***MASKED***";
          return acc;
        },
        {} as Record<string, string>
      ),
    };

    return NextResponse.json({ connection: safeConnection });
  } catch (error) {
    logger.error({ error }, "Failed to get ERP connection");
    return NextResponse.json(
      { error: "Failed to get ERP connection" },
      { status: 500 }
    );
  }
}

// PATCH /api/erp-connections/[id]
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const tenantId = request.headers.get("x-tenant-id");

    const body = await request.json();
    const validated = erpConnectionUpdateSchema.parse(body);

    const existing = await prisma.erpConnection.findFirst({
      where: { id, tenantId: tenantId ?? undefined },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "ERP connection not found" },
        { status: 404 }
      );
    }

    const connection = await prisma.erpConnection.update({
      where: { id },
      data: {
        ...(validated.connectionName && { connectionName: validated.connectionName }),
        ...(validated.connectionString && { connectionString: validated.connectionString }),
        ...(validated.authConfig && { authConfig: validated.authConfig as any }),
        ...(validated.fieldMappings && { fieldMappings: validated.fieldMappings as any }),
      },
    });

    logger.info(
      { connectionId: id, erpType: connection.erpType },
      "Updated ERP connection"
    );

    return NextResponse.json({
      connection: {
        id: connection.id,
        erpType: connection.erpType,
        connectionName: connection.connectionName,
        syncStatus: connection.syncStatus,
        updatedAt: connection.updatedAt,
      },
    });
  } catch (error) {
    logger.error({ error }, "Failed to update ERP connection");
    return NextResponse.json(
      { error: "Failed to update ERP connection" },
      { status: 500 }
    );
  }
}

// DELETE /api/erp-connections/[id]
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const tenantId = request.headers.get("x-tenant-id");

    const existing = await prisma.erpConnection.findFirst({
      where: { id, tenantId: tenantId ?? undefined },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "ERP connection not found" },
        { status: 404 }
      );
    }

    // Delete sync logs first
    await prisma.syncLog.deleteMany({
      where: { erpConnectionId: id },
    });

    // Delete the connection
    await prisma.erpConnection.delete({
      where: { id },
    });

    logger.info({ connectionId: id, erpType: existing.erpType }, "Deleted ERP connection");

    return NextResponse.json({ deleted: true });
  } catch (error) {
    logger.error({ error }, "Failed to delete ERP connection");
    return NextResponse.json(
      { error: "Failed to delete ERP connection" },
      { status: 500 }
    );
  }
}
