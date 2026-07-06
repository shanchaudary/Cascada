// POST /api/cascade/triggers/[id]/analyze — Run full cascade analysis for a trigger

import { NextResponse } from "next/server";
import { traverseForTrigger, scoreCascadeImpact, estimateCascadeCosts, buildComplianceTimeline } from "@/lib/cascade";
import { cascadeTriggerAnalyzeSchema } from "@/lib/validation";
import { ValidationError, CascadeTraversalError } from "@/lib/errors";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: triggerId } = await params;
    const body = await request.json();
    const parsed = cascadeTriggerAnalyzeSchema.safeParse(body);

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

    // Step 1: Get the trigger to find the rule and affected nodes
    const { getCascadeTrigger } = await import("@/lib/cascade");
    const trigger = await getCascadeTrigger(tenantId, triggerId);

    if (!trigger) {
      return NextResponse.json(
        { error: "Trigger not found" },
        { status: 404 }
      );
    }

    // Step 2: Run cascade traversal
    const traversalResult = await traverseForTrigger({
      triggerId,
      ruleId: trigger.ruleId,
      tenantId,
      triggerType: trigger.triggerType,
      severity: trigger.severity,
      affectedNodeIds: trigger.affectedNodeIds,
    });

    // Step 3: Score impacts
    const impactResult = await scoreCascadeImpact({
      triggerId,
      tenantId,
      traversalResult: traversalResult.traversalResult,
      affectedNodeIds: traversalResult.affectedNodeIds,
    });

    // Step 4: Estimate costs (if requested)
    let costResult = null;
    if (parsed.data.includeCostEstimates) {
      costResult = await estimateCascadeCosts({
        triggerId,
        tenantId,
        impactIds: impactResult.impactRecords.map((r) => r.nodeId),
      });
    }

    // Step 5: Build compliance timeline (if requested)
    let timelineResult = null;
    if (parsed.data.includeTimelineConflicts) {
      timelineResult = await buildComplianceTimeline({
        triggerId,
        tenantId,
        affectedNodeIds: traversalResult.affectedNodeIds,
      });
    }

    return NextResponse.json({
      triggerId,
      status: "IMPACT_ASSESSED",
      traversal: {
        cascadeDepth: traversalResult.cascadeDepth,
        cascadeBreadth: traversalResult.cascadeBreadth,
        totalSkusAffected: traversalResult.totalSkusAffected,
        affectedNodeCount: traversalResult.affectedNodeIds.length,
      },
      impacts: {
        totalFinancialImpact: impactResult.compositeScore.totalFinancialImpact,
        maxSeverity: impactResult.compositeScore.maxSeverity,
        overallRiskScore: impactResult.compositeScore.overallRiskScore,
        impactCount: impactResult.nodeImpacts.length,
        impactByType: impactResult.compositeScore.impactByType,
      },
      costs: costResult ? {
        totalCostMin: costResult.totalCostMin,
        totalCostMax: costResult.totalCostMax,
        reformulationCount: costResult.reformulationCosts.length,
        labelChangeCount: costResult.labelChangeCosts.length,
        timelineDays: costResult.timelineDays,
        revenueAtRisk: costResult.revenueAtRisk,
      } : null,
      timeline: timelineResult ? {
        eventCount: timelineResult.events.length,
        conflictCount: timelineResult.conflicts.length,
        criticalPathLength: timelineResult.criticalPath.length,
        events: timelineResult.events,
        conflicts: timelineResult.conflicts,
      } : null,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    if (error instanceof CascadeTraversalError) {
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
