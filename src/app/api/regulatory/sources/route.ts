// Cascada — GET /api/regulatory/sources
// List all regulatory sources with optional filtering and pagination.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createTenantLogger } from "@/lib/logger";
import { CascadaError } from "@/lib/errors";
import { paginationSchema } from "@/lib/validation";
import type { SourceType, SourceStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const pagination = paginationSchema.parse(Object.fromEntries(searchParams));

    const sourceType = searchParams.get("sourceType")?.split(",") as SourceType[] | null;
    const status = searchParams.get("status")?.split(",") as SourceStatus[] | null;
    const jurisdiction = searchParams.get("jurisdiction")?.split(",");
    const search = searchParams.get("search");

    const where = {
      ...(sourceType && { sourceType: { in: sourceType } }),
      ...(status && { status: { in: status } }),
      ...(jurisdiction && { jurisdiction: { in: jurisdiction } }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { fullText: { contains: search, mode: "insensitive" as const } },
        ],
      }),
    };

    const [sources, total] = await Promise.all([
      prisma.regulatorySource.findMany({
        where,
        include: {
          rules: {
            select: {
              id: true,
              ruleType: true,
              version: true,
              smeValidatedBy: true,
            },
            orderBy: { version: "desc" },
          },
          _count: { select: { rules: true } },
        },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        orderBy: { createdAt: pagination.sortOrder },
      }),
      prisma.regulatorySource.count({ where }),
    ]);

    return NextResponse.json({
      data: sources,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: Math.ceil(total / pagination.limit),
      },
    });
  } catch (error) {
    if (error instanceof CascadaError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const logger = createTenantLogger("system");
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Failed to list regulatory sources");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
