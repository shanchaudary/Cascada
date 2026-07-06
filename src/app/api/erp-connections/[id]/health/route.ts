// Cascada — ERP Connection Health API Route
// GET: Check the health/connectivity of an ERP connection

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import logger from "@/lib/logger";
import { createConnectorByType } from "@/lib/erp";
import type { ErpConnectorParams } from "@/lib/erp/types";
import type { FieldMappingConfig } from "@/types/erp";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/erp-connections/[id]/health
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const tenantId = request.headers.get("x-tenant-id");

    const connection = await prisma.erpConnection.findFirst({
      where: { id, tenantId: tenantId ?? undefined },
    });

    if (!connection) {
      return NextResponse.json({ error: "ERP connection not found" }, { status: 404 });
    }

    const params: ErpConnectorParams = {
      erpType: connection.erpType,
      connectionId: connection.id,
      tenantId: connection.tenantId,
      connectionString: connection.connectionString,
      authConfig: connection.authConfig as Record<string, unknown>,
      fieldMappings: (connection.fieldMappings as unknown as FieldMappingConfig) ?? {
        ingredient: [],
        formulation: [],
        product: [],
        customer: [],
        supplier: [],
      },
      syncState: (connection.syncState as Record<string, unknown>) ?? {},
    };

    const connector = createConnectorByType(params);
    const healthResult = await connector.testConnection();

    // Update connection status based on health check
    await prisma.erpConnection.update({
      where: { id },
      data: {
        syncStatus: healthResult.success ? "CONNECTED" : "ERROR",
        ...(healthResult.success ? { lastSyncError: null } : { lastSyncError: healthResult.message }),
      },
    });

    return NextResponse.json({
      health: {
        connected: healthResult.success,
        message: healthResult.message,
        latencyMs: healthResult.latencyMs,
        serverInfo: healthResult.serverInfo,
        permissions: healthResult.permissions,
        erpType: connection.erpType,
        connectionId: connection.id,
        lastSyncAt: connection.lastSyncAt,
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error({ error }, "ERP health check failed");

    return NextResponse.json({
      health: {
        connected: false,
        message: error instanceof Error ? error.message : "Health check failed",
        latencyMs: -1,
        checkedAt: new Date().toISOString(),
      },
    }, { status: 502 });
  }
}
