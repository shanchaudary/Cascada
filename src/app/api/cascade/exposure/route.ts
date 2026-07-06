// GET /api/cascade/exposure — Get exposure summary (by jurisdiction, by product)

import { NextResponse } from "next/server";
import { getExposureByJurisdiction, getExposureByProduct } from "@/lib/cascade";

export async function GET(request: Request) {
  try {
    // TODO: Extract tenantId from auth session (Stage 8 full impl)
    const tenantId = process.env["DEFAULT_TENANT_ID"] ?? "demo-tenant";

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") ?? "jurisdiction";

    if (view === "product") {
      const exposure = await getExposureByProduct(tenantId);
      return NextResponse.json({ exposure, total: exposure.length });
    }

    // Default: jurisdiction view
    const exposure = await getExposureByJurisdiction(tenantId);
    return NextResponse.json({ exposure, total: exposure.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
