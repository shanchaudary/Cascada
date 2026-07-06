// GET /api/cascade/triggers — List cascade triggers

import { NextResponse } from "next/server";
import { getCascadeTriggers } from "@/lib/cascade";
import type { Severity, TriggerStatus } from "@prisma/client";

export async function GET(request: Request) {
  try {
    // TODO: Extract tenantId from auth session (Stage 8 full impl)
    const tenantId = process.env["DEFAULT_TENANT_ID"] ?? "demo-tenant";

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as TriggerStatus | null;
    const severity = searchParams.get("severity") as Severity | null;

    const triggers = await getCascadeTriggers(tenantId, {
      ...(status && { status }),
      ...(severity && { severity }),
    });

    return NextResponse.json({ triggers, total: triggers.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
