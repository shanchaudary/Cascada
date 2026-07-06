// Cascada — GET /api/regulatory/rules/:id/substances
// Get all substances for a specific rule with ingredient match details.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createTenantLogger } from "@/lib/logger";
import { NotFoundError, CascadaError } from "@/lib/errors";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify the rule exists
    const rule = await prisma.rule.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!rule) {
      throw new NotFoundError("Rule", id);
    }

    const substances = await prisma.ruleSubstance.findMany({
      where: { ruleId: id },
      include: {
        ingredient: {
          select: {
            id: true,
            name: true,
            alternateNames: true,
            category: true,
            casNumber: true,
            eenumber: true,
            isSynthetic: true,
            sourceType: true,
            allergenFlags: true,
            formulationItems: {
              select: {
                formulation: {
                  select: {
                    id: true,
                    name: true,
                    products: {
                      select: {
                        product: {
                          select: {
                            id: true,
                            name: true,
                            sku: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { substanceName: "asc" },
    });

    const summary = {
      total: substances.length,
      matched: substances.filter((s) => s.isMatched).length,
      unmatched: substances.filter((s) => !s.isMatched).length,
      byMethod: substances.reduce<Record<string, number>>((acc, s) => {
        const method = s.matchMethod ?? "unmatched";
        acc[method] = (acc[method] ?? 0) + 1;
        return acc;
      }, {}),
      byType: substances.reduce<Record<string, number>>((acc, s) => {
        acc[s.substanceType] = (acc[s.substanceType] ?? 0) + 1;
        return acc;
      }, {}),
    };

    return NextResponse.json({
      data: substances,
      summary,
    });
  } catch (error) {
    if (error instanceof CascadaError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const logger = createTenantLogger("system");
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Failed to get rule substances");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
