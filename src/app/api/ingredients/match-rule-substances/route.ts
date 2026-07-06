// Cascada — POST /api/ingredients/match-rule-substances
// Trigger substance matching for a tenant's unmatched rule substances.
// Uses deterministic matching first, then optional LLM-assisted matching.

import { NextRequest, NextResponse } from "next/server";
import { createTenantLogger } from "@/lib/logger";
import { CascadaError } from "@/lib/errors";
import { matchRuleSubstancesSchema } from "@/lib/validation";
import { matchAllSubstances } from "@/lib/rules/substance-matcher";
import type { SubstanceMatchResult } from "@/types/regulatory";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = matchRuleSubstancesSchema.parse(body);

    const logger = createTenantLogger(validated.tenantId);
    logger.info(
      {
        tenantId: validated.tenantId,
        useLlm: validated.useLlm,
        minConfidence: validated.minConfidence,
      },
      "Starting substance matching"
    );

    const result: SubstanceMatchResult = await matchAllSubstances(
      validated.tenantId,
      {
        useLlm: validated.useLlm,
        minConfidence: validated.minConfidence,
      }
    );

    return NextResponse.json({
      data: result,
      message: `Matched ${result.matched} of ${result.totalSubstances} substances (${result.lowConfidence} low confidence)`,
    });
  } catch (error) {
    if (error instanceof CascadaError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const logger = createTenantLogger("system");
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Substance matching failed"
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
