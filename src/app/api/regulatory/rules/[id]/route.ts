// Cascada — GET /api/regulatory/rules/:id
// Get a single rule with full details including substances and version chain.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createTenantLogger } from "@/lib/logger";
import { NotFoundError, CascadaError } from "@/lib/errors";
import { getRuleVersionChain } from "@/lib/rules/versioning";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const rule = await prisma.rule.findUnique({
      where: { id },
      include: {
        source: true,
        substances: {
          include: {
            ingredient: {
              select: {
                id: true,
                name: true,
                alternateNames: true,
                category: true,
                casNumber: true,
                eenumber: true,
              },
            },
          },
        },
        cascadeTriggers: {
          include: {
            impacts: true,
          },
        },
      },
    });

    if (!rule) {
      throw new NotFoundError("Rule", id);
    }

    // Get version chain for context
    const versionChain = await getRuleVersionChain(id);

    return NextResponse.json({
      data: rule,
      versionHistory: versionChain,
    });
  } catch (error) {
    if (error instanceof CascadaError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const logger = createTenantLogger("system");
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Failed to get rule");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
