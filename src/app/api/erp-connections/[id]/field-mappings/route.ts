// Cascada — ERP Connection Field Mappings API Route
// GET: Get current field mappings for an ERP connection
// PUT: Update field mappings for an ERP connection

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import logger from "@/lib/logger";
import type { FieldMappingConfig } from "@/types/erp";
import { z } from "zod";

const fieldMappingSchema = z.object({
  ingredient: z.array(z.object({
    localField: z.string().min(1),
    erpField: z.string().min(1),
    transform: z.enum(["none", "uppercase", "lowercase", "trim", "parse_number", "parse_date"]).optional(),
    defaultValue: z.unknown().optional(),
    required: z.boolean().optional(),
  })),
  formulation: z.array(z.object({
    localField: z.string().min(1),
    erpField: z.string().min(1),
    transform: z.enum(["none", "uppercase", "lowercase", "trim", "parse_number", "parse_date"]).optional(),
    defaultValue: z.unknown().optional(),
    required: z.boolean().optional(),
  })),
  product: z.array(z.object({
    localField: z.string().min(1),
    erpField: z.string().min(1),
    transform: z.enum(["none", "uppercase", "lowercase", "trim", "parse_number", "parse_date"]).optional(),
    defaultValue: z.unknown().optional(),
    required: z.boolean().optional(),
  })),
  customer: z.array(z.object({
    localField: z.string().min(1),
    erpField: z.string().min(1),
    transform: z.enum(["none", "uppercase", "lowercase", "trim", "parse_number", "parse_date"]).optional(),
    defaultValue: z.unknown().optional(),
    required: z.boolean().optional(),
  })),
  supplier: z.array(z.object({
    localField: z.string().min(1),
    erpField: z.string().min(1),
    transform: z.enum(["none", "uppercase", "lowercase", "trim", "parse_number", "parse_date"]).optional(),
    defaultValue: z.unknown().optional(),
    required: z.boolean().optional(),
  })),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/erp-connections/[id]/field-mappings
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const tenantId = request.headers.get("x-tenant-id");

    const connection = await prisma.erpConnection.findFirst({
      where: { id, tenantId: tenantId ?? undefined },
      select: { id: true, erpType: true, fieldMappings: true },
    });

    if (!connection) {
      return NextResponse.json({ error: "ERP connection not found" }, { status: 404 });
    }

    // Get default mappings for this ERP type
    const { ERP_SYNC_DEFAULTS } = await import("@/lib/erp/types");
    const defaultConfig = ERP_SYNC_DEFAULTS[connection.erpType as keyof typeof ERP_SYNC_DEFAULTS];

    return NextResponse.json({
      fieldMappings: connection.fieldMappings ?? {},
      erpType: connection.erpType,
      defaultEndpoints: defaultConfig?.entityEndpoints ?? {},
      supportedEntities: defaultConfig?.supportedEntities ?? [],
    });
  } catch (error) {
    logger.error({ error }, "Failed to get field mappings");
    return NextResponse.json(
      { error: "Failed to get field mappings" },
      { status: 500 }
    );
  }
}

// PUT /api/erp-connections/[id]/field-mappings
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const tenantId = request.headers.get("x-tenant-id");

    const connection = await prisma.erpConnection.findFirst({
      where: { id, tenantId: tenantId ?? undefined },
    });

    if (!connection) {
      return NextResponse.json({ error: "ERP connection not found" }, { status: 404 });
    }

    const body = await request.json();
    const validated = fieldMappingSchema.parse(body);

    await prisma.erpConnection.update({
      where: { id },
      data: { fieldMappings: validated as any },
    });

    logger.info(
      { connectionId: id, erpType: connection.erpType },
      "Updated field mappings for ERP connection"
    );

    return NextResponse.json({
      fieldMappings: validated,
      message: "Field mappings updated successfully",
    });
  } catch (error) {
    logger.error({ error }, "Failed to update field mappings");
    return NextResponse.json(
      { error: "Failed to update field mappings" },
      { status: 500 }
    );
  }
}
