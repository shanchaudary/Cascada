// Cascada — GET /api/regulatory/sources/:id
// Get a single regulatory source with its rules and substances.

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

    const source = await prisma.regulatorySource.findUnique({
      where: { id },
      include: {
        rules: {
          include: {
            substances: true,
            cascadeTriggers: {
              select: {
                id: true,
                severity: true,
                status: true,
                title: true,
              },
            },
          },
          orderBy: { version: "desc" },
        },
      },
    });

    if (!source) {
      throw new NotFoundError("RegulatorySource", id);
    }

    return NextResponse.json({ data: source });
  } catch (error) {
    if (error instanceof CascadaError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const logger = createTenantLogger("system");
    logger.error({ error: error instanceof Error ? error.message : String(error) }, "Failed to get regulatory source");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
