// Cascada — ERP Connection Sync API Route
// POST: Trigger a sync (full or incremental) for an ERP connection

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import logger from "@/lib/logger";
import { ErpConnectionError, ErpSyncError } from "@/lib/errors";
import { ErpSyncEngine } from "@/lib/erp";
import { createConnectorByType } from "@/lib/erp";
import type { ErpConnectorParams } from "@/lib/erp/types";
import type { FieldMappingConfig } from "@/types/erp";
import { z } from "zod";

const syncRequestSchema = z.object({
  syncType: z.enum(["full", "incremental"]).default("incremental"),
  entityType: z.enum(["ingredients", "formulations", "products", "customers", "suppliers"]).optional(),
  conflictStrategy: z.enum(["erp_wins", "local_wins", "newer_wins", "manual", "merge"]).default("newer_wins"),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/erp-connections/[id]/sync
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const tenantId = request.headers.get("x-tenant-id");

    if (!tenantId) {
      return NextResponse.json({ error: "Tenant context required" }, { status: 400 });
    }

    const body = await request.json();
    const validated = syncRequestSchema.parse(body);

    // Get the connection
    const connection = await prisma.erpConnection.findFirst({
      where: { id, tenantId },
    });

    if (!connection) {
      return NextResponse.json({ error: "ERP connection not found" }, { status: 404 });
    }

    if (connection.syncStatus === "SYNCING") {
      return NextResponse.json(
        { error: "Sync already in progress for this connection" },
        { status: 409 }
      );
    }

    // Create connector instance
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

    // Execute sync
    const syncEngine = new ErpSyncEngine();

    logger.info(
      {
        connectionId: id,
        erpType: connection.erpType,
        syncType: validated.syncType,
        entityType: validated.entityType,
        conflictStrategy: validated.conflictStrategy,
      },
      "Starting ERP sync"
    );

    if (validated.syncType === "full") {
      const result = await syncEngine.executeFullSync(
        connector,
        tenantId,
        id,
        validated.conflictStrategy
      );

      logger.info(
        {
          connectionId: id,
          ingredientCount: result.ingredients.recordsSuccess,
          formulationCount: result.formulations.recordsSuccess,
          productCount: result.products.recordsSuccess,
          customerCount: result.customers.recordsSuccess,
          supplierCount: result.suppliers.recordsSuccess,
          totalDurationMs: result.totalDurationMs,
        },
        "Full ERP sync completed"
      );

      return NextResponse.json({
        syncType: "full",
        results: {
          ingredients: {
            total: result.ingredients.recordsTotal,
            success: result.ingredients.recordsSuccess,
            failed: result.ingredients.recordsFailed,
            durationMs: result.ingredients.durationMs,
          },
          formulations: {
            total: result.formulations.recordsTotal,
            success: result.formulations.recordsSuccess,
            failed: result.formulations.recordsFailed,
            durationMs: result.formulations.durationMs,
          },
          products: {
            total: result.products.recordsTotal,
            success: result.products.recordsSuccess,
            failed: result.products.recordsFailed,
            durationMs: result.products.durationMs,
          },
          customers: {
            total: result.customers.recordsTotal,
            success: result.customers.recordsSuccess,
            failed: result.customers.recordsFailed,
            durationMs: result.customers.durationMs,
          },
          suppliers: {
            total: result.suppliers.recordsTotal,
            success: result.suppliers.recordsSuccess,
            failed: result.suppliers.recordsFailed,
            durationMs: result.suppliers.durationMs,
          },
          totalDurationMs: result.totalDurationMs,
        },
      });
    } else {
      // Incremental sync for specific entity type (or all if not specified)
      const entityType = validated.entityType ?? "ingredients";

      const result = await syncEngine.executeIncrementalSync(
        connector,
        tenantId,
        id,
        entityType as "ingredients" | "formulations" | "products" | "customers" | "suppliers",
        validated.conflictStrategy
      );

      logger.info(
        {
          connectionId: id,
          entityType,
          total: result.recordsTotal,
          success: result.recordsSuccess,
          failed: result.recordsFailed,
          durationMs: result.durationMs,
        },
        "Incremental ERP sync completed"
      );

      return NextResponse.json({
        syncType: "incremental",
        entityType,
        results: {
          total: result.recordsTotal,
          success: result.recordsSuccess,
          failed: result.recordsFailed,
          durationMs: result.durationMs,
          errors: result.errors.slice(0, 10), // Limit error details in response
        },
      });
    }
  } catch (error) {
    logger.error({ error }, "ERP sync failed");

    if (error instanceof ErpConnectionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    if (error instanceof ErpSyncError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: "ERP sync failed" },
      { status: 500 }
    );
  }
}
