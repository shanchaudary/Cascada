// GET /api/cascade/graph — Get the current cascade graph for the tenant

import { NextResponse } from "next/server";
import { getCascadeGraph } from "@/lib/cascade";

export async function GET() {
  try {
    // TODO: Extract tenantId from auth session (Stage 8 full impl)
    const tenantId = process.env["DEFAULT_TENANT_ID"] ?? "demo-tenant";

    const graph = await getCascadeGraph(tenantId);

    if (!graph) {
      return NextResponse.json(
        { error: "No cascade graph found. Build the graph first." },
        { status: 404 }
      );
    }

    return NextResponse.json(graph);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
