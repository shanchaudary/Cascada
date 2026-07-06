// Cascada — GET /api/regulatory/search
// Full-text search across regulatory sources and rules.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createTenantLogger } from "@/lib/logger";
import { CascadaError } from "@/lib/errors";
import { regulatorySearchSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = regulatorySearchSchema.parse(Object.fromEntries(searchParams));

    const logger = createTenantLogger("system");
    logger.info({ query: query.query }, "Regulatory search");

    // Search across sources
    const sourcesWhere: Record<string, unknown> = {
      ...(query.sourceType && { sourceType: { in: query.sourceType } }),
      ...(query.jurisdiction && { jurisdiction: { in: query.jurisdiction } }),
      ...(query.status && { status: { in: query.status } }),
      OR: [
        { name: { contains: query.query, mode: "insensitive" } },
        { fullText: { contains: query.query, mode: "insensitive" } },
      ],
    };

    const sources = await prisma.regulatorySource.findMany({
      where: sourcesWhere,
      include: {
        rules: {
          select: {
            id: true,
            ruleType: true,
            version: true,
            description: true,
            smeValidatedBy: true,
          },
        },
        _count: { select: { rules: true } },
      },
      take: query.limit,
      orderBy: { createdAt: "desc" },
    });

    // Search across rules (including substance name matching)
    const rulesWhere: Record<string, unknown> = {
      ...(query.ruleType && { ruleType: { in: query.ruleType } }),
      ...(query.jurisdiction && { jurisdiction: { in: query.jurisdiction } }),
      OR: [
        { description: { contains: query.query, mode: "insensitive" } },
        { notes: { contains: query.query, mode: "insensitive" } },
        {
          substances: {
            some: {
              substanceName: { contains: query.query, mode: "insensitive" },
            },
          },
        },
      ],
    };

    const rules = await prisma.rule.findMany({
      where: rulesWhere,
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
          where: {
            substanceName: { contains: query.query, mode: "insensitive" },
          },
          select: {
            id: true,
            substanceName: true,
            substanceType: true,
            casNumber: true,
            eenumber: true,
            isMatched: true,
            matchConfidence: true,
          },
        },
      },
      take: query.limit,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      data: {
        sources,
        rules,
        totalSources: sources.length,
        totalRules: rules.length,
      },
      query: query.query,
    });
  } catch (error) {
    if (error instanceof CascadaError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const logger = createTenantLogger("system");
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Regulatory search failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
