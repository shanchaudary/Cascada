// Cascada — GET /api/regulatory/rules
// List all rules with optional filtering by source, type, jurisdiction, validation status.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createTenantLogger } from "@/lib/logger";
import { CascadaError } from "@/lib/errors";
import { paginationSchema } from "@/lib/validation";
import type { RuleType } from "@prisma/client";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const pagination = paginationSchema.parse(Object.fromEntries(searchParams));

    const sourceId = searchParams.get("sourceId");
    const ruleType = searchParams.get("ruleType")?.split(",") as RuleType[] | null;
    const jurisdiction = searchParams.get("jurisdiction")?.split(",");
    const validated = searchParams.get("validated"); // "true" | "false" | "all"
    const substanceName = searchParams.get("substanceName");
    const casNumber = searchParams.get("casNumber");

    // Build where clause
    const where: Record<string, unknown> = {};
    if (sourceId) where["sourceId"] = sourceId;
    if (ruleType) where["ruleType"] = { in: ruleType };
    if (jurisdiction) where["jurisdiction"] = { in: jurisdiction };
    if (validated === "true") {
      where["smeValidatedBy"] = { not: null };
    } else if (validated === "false") {
      where["smeValidatedBy"] = null;
    }

    // Substance filtering requires a sub-query
    if (substanceName || casNumber) {
      where["substances"] = {
        some: {
          ...(substanceName && {
            substanceName: { contains: substanceName, mode: "insensitive" },
          }),
          ...(casNumber && { casNumber }),
        },
      };
    }

    const [rules, total] = await Promise.all([
      prisma.rule.findMany({
        where,
        include: {
          source: {
            select: {
              id: true,
              name: true,
              sourceType: true,
              jurisdiction: true,
              status: true,
            },
          },
          substances: {
            include: {
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                },
              },
            },
          },
          cascadeTriggers: {
            select: {
              id: true,
              severity: true,
              status: true,
            },
          },
        },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        orderBy: { createdAt: pagination.sortOrder },
      }),
      prisma.rule.count({ where }),
    ]);

    return NextResponse.json({
      data: rules,
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
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Failed to list rules");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
