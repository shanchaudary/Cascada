// POST /api/cascade/exposure/diagnostic — Run a diagnostic exposure scan

import { NextResponse } from "next/server";
import { getExposureByJurisdiction, getExposureByProduct, prioritizeTriggers } from "@/lib/cascade";
import { cascadeDiagnosticSchema } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = cascadeDiagnosticSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    // TODO: Extract tenantId from auth session (Stage 8 full impl)
    const tenantId = process.env["DEFAULT_TENANT_ID"] ?? "demo-tenant";

    // Run exposure analysis for the diagnostic
    const [jurisdictionExposure, productExposure, prioritization] = await Promise.all([
      getExposureByJurisdiction(tenantId),
      getExposureByProduct(tenantId),
      prioritizeTriggers({ tenantId }),
    ]);

    // Filter by requested markets and product categories
    const filteredJurisdictionExposure = jurisdictionExposure.filter((j) =>
      parsed.data.markets.some((m) => j.jurisdiction.startsWith(m))
    );

    const totalEstimatedCostMin = filteredJurisdictionExposure.reduce(
      (sum, j) => sum + j.estimatedCostMin,
      0
    );
    const totalEstimatedCostMax = filteredJurisdictionExposure.reduce(
      (sum, j) => sum + j.estimatedCostMax,
      0
    );

    const diagnosticResult = {
      summary: {
        totalJurisdictionsAffected: filteredJurisdictionExposure.length,
        totalProductsAffected: productExposure.length,
        totalTriggers: prioritization.totalTriggers,
        criticalTriggers: prioritization.criticalCount,
        highTriggers: prioritization.highCount,
        estimatedCostMin: totalEstimatedCostMin,
        estimatedCostMax: totalEstimatedCostMax,
      },
      exposureByJurisdiction: filteredJurisdictionExposure,
      exposureByProduct: productExposure.slice(0, 20), // Top 20 products
      prioritizedTriggers: prioritization.triggers.slice(0, 10), // Top 10 triggers
      riskProfile: {
        averageRiskScore: prioritization.averageRiskScore,
        averageImpactScore: prioritization.averageImpactScore,
        averageUrgencyScore: prioritization.averageUrgencyScore,
      },
      productCategories: parsed.data.productCategories,
      markets: parsed.data.markets,
      ingredientsOfConcern: parsed.data.ingredientsOfConcern ?? [],
    };

    return NextResponse.json(diagnosticResult, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
