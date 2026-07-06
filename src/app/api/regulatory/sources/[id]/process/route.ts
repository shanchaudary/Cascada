// Cascada — POST /api/regulatory/sources/:id/process
// Trigger LLM-based rule parsing for a regulatory source.
// This is the main entry point for the rule engine — it takes raw
// regulatory text and produces structured Rule + RuleSubstance records.

import { NextRequest, NextResponse } from "next/server";
import { createTenantLogger } from "@/lib/logger";
import { CascadaError } from "@/lib/errors";
import { regulatorySourceProcessSchema } from "@/lib/validation";
import { parseRegulatorySource, enrichSubstances, type RuleParsingResult } from "@/lib/rules/parser";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validated = regulatorySourceProcessSchema.parse(body);

    const logger = createTenantLogger("system");
    logger.info(
      { sourceId: id, forceReprocess: validated.forceReprocess },
      "Processing regulatory source"
    );

    // Parse the source using the LLM rule engine
    const result: RuleParsingResult = await parseRegulatorySource(id, {
      forceReprocess: validated.forceReprocess,
    });

    // Optionally enrich substances with additional LLM analysis
    if (validated.enrichSubstances && result.rulesCreated > 0) {
      try {
        await enrichSubstances(id);
      } catch (enrichError) {
        logger.warn(
          { sourceId: id, error: enrichError instanceof Error ? enrichError.message : String(enrichError) },
          "Substance enrichment failed (non-fatal)"
        );
        // Enrichment failure is non-fatal — the rules are already created
      }
    }

    return NextResponse.json({
      data: result,
      message: result.rulesCreated > 0
        ? `Successfully parsed ${result.rulesCreated} rules with ${result.substancesCreated} substances`
        : "Source already parsed. Use forceReprocess=true to re-parse.",
    }, { status: result.rulesCreated > 0 ? 201 : 200 });
  } catch (error) {
    if (error instanceof CascadaError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const logger = createTenantLogger("system");
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to process regulatory source"
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
