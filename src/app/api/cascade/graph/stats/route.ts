// GET /api/cascade/graph/stats — Get cascade graph statistics

import { NextResponse } from "next/server";
import { getGraphStats } from "@/lib/cascade";

export async function GET() {
  try {
    // TODO: Extract tenantId from auth session (Stage 8 full impl)
    const tenantId = process.env["DEFAULT_TENANT_ID"] ?? "demo-tenant";

    const stats = await getGraphStats(tenantId);

    return NextResponse.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
