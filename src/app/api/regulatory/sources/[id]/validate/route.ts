// Cascada — POST /api/regulatory/sources/:id/validate
// SME validation endpoint — approve or reject LLM-parsed rules.
// No rule enters the cascade engine without SME approval.

import { NextRequest, NextResponse } from "next/server";
import { createTenantLogger } from "@/lib/logger";
import { CascadaError } from "@/lib/errors";
import { regulatorySourceValidateSchema } from "@/lib/validation";
import { validateRule, bulkValidateRules } from "@/lib/rules/validation";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = regulatorySourceValidateSchema.parse(body);

    const logger = createTenantLogger("system");
    logger.info(
      { sourceId: id, approved: validated.approved },
      "SME validation request"
    );

    // Find all unvalidated rules for this source
    const rules = await prisma.rule.findMany({
      where: {
        sourceId: id,
        smeValidatedBy: null,
      },
    });

    if (rules.length === 0) {
      return NextResponse.json({
        data: { sourceId: id, status: "no_unvalidated_rules" },
        message: "No unvalidated rules found for this source",
      });
    }

    // Get validator info from auth (simplified — full auth in Stage 8)
    const validatorId = request.headers.get("x-user-id") ?? "system";
    const validatorRole = request.headers.get("x-user-role") ?? "COMPLIANCE";

    // Validate all rules for this source
    const results = await bulkValidateRules(
      rules.map((r) => r.id),
      validatorId,
      validatorRole,
      validated.approved,
      validated.notes
    );

    return NextResponse.json({
      data: {
        sourceId: id,
        validated: results.length,
        approved: results.filter((r) => r.status === "SME_APPROVED").length,
        rejected: results.filter((r) => r.status === "SME_REJECTED").length,
        results,
      },
      message: validated.approved
        ? `${results.length} rules approved`
        : `${results.length} rules rejected`,
    });
  } catch (error) {
    if (error instanceof CascadaError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const logger = createTenantLogger("system");
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to validate regulatory source"
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
