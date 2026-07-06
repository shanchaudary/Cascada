// GET /api/cascade/triggers/[id]/impacts — Get impacts for a trigger

import { NextResponse } from "next/server";
import { getTriggerImpacts } from "@/lib/cascade";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: triggerId } = await params;
    // TODO: Extract tenantId from auth session (Stage 8 full impl)
    const tenantId = process.env["DEFAULT_TENANT_ID"] ?? "demo-tenant";

    const impacts = await getTriggerImpacts(tenantId, triggerId);

    return NextResponse.json({ impacts, total: impacts.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
