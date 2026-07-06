// POST /api/cascade/graph/rebuild — Rebuild the cascade graph for the tenant

import { NextResponse } from "next/server";
import { buildCascadeGraph } from "@/lib/cascade";
import { cascadeGraphRebuildSchema } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = cascadeGraphRebuildSchema.safeParse(body);

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

    const result = await buildCascadeGraph(tenantId, {
      fullRebuild: parsed.data.fullRebuild,
    });

    return NextResponse.json(result, { status: 201 });
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
