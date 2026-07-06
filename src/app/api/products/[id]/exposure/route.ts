// Cascada — Product Regulatory Exposure API Route
// GET /api/products/[id]/exposure — Product's regulatory exposure including
//   matched RuleSubstances, cascade triggers, and impacts

import { NextRequest, NextResponse } from "next/server";
import { prisma, withTenant } from "@/lib/db";
import logger, { createTenantLogger } from "@/lib/logger";
import { auth } from "@/lib/auth";
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
  CascadaError,
  toError,
} from "@/lib/errors";
import { ZodError } from "zod";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Extract and validate the current session + tenant context.
 */
async function getAuthenticatedContext() {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Authentication required");
  }

  const sessionUser = session.user as Record<string, unknown>;
  const userId = sessionUser["id"] as string | undefined;
  const tenantId = sessionUser["tenantId"] as string | undefined;
  const role = sessionUser["role"] as string | undefined;

  if (!userId || !tenantId || !role) {
    throw new AuthenticationError("Session is missing required claims");
  }

  return { userId, tenantId, role };
}

/**
 * Transform a ZodError into our structured ValidationError format.
 */
function formatZodError(zodErr: ZodError): ValidationError {
  const fieldErrors = zodErr.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
  return new ValidationError(fieldErrors);
}

// GET /api/products/[id]/exposure — Product's regulatory exposure
export async function GET(request: NextRequest, context: RouteContext) {
  const requestStart = Date.now();

  try {
    const { id: productId } = await context.params;
    const { userId, tenantId, role } = await getAuthenticatedContext();

    // Verify the product exists and belongs to the tenant
    const product = await withTenant(tenantId, async () => {
      return prisma.product.findFirst({
        where: { id: productId, tenantId },
        include: {
          formulations: {
            where: { isCurrent: true },
            include: {
              formulation: {
                select: {
                  id: true,
                  name: true,
                  version: true,
                  status: true,
                  items: {
                    select: {
                      ingredientId: true,
                      quantity: true,
                      unit: true,
                      percentage: true,
                      ingredient: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          casNumber: true,
                          eenumber: true,
                          allergenFlags: true,
                          isSynthetic: true,
                          sourceType: true,
                        },
                      },
                    },
                    orderBy: { sortOrder: "asc" },
                  },
                },
              },
            },
          },
        },
      });
    });

    if (!product) {
      throw new NotFoundError("Product", productId);
    }

    // Collect all ingredient IDs from current formulation
    const currentFormulationLink = product.formulations.find((pf) => pf.isCurrent);
    const ingredientIds: string[] = [];

    if (currentFormulationLink) {
      for (const item of currentFormulationLink.formulation.items) {
        ingredientIds.push(item.ingredientId);
      }
    }

    // Fetch matched RuleSubstances for these ingredients
    const matchedRuleSubstances = ingredientIds.length > 0
      ? await prisma.ruleSubstance.findMany({
          where: {
            ingredientId: { in: ingredientIds },
            isMatched: true,
          },
          include: {
            rule: {
              select: {
                id: true,
                jurisdiction: true,
                ruleType: true,
                description: true,
                effectiveDate: true,
                complianceDate: true,
                penaltyType: true,
                penaltyAmount: true,
                source: {
                  select: {
                    id: true,
                    name: true,
                    sourceType: true,
                    status: true,
                    jurisdiction: true,
                  },
                },
              },
            },
            ingredient: {
              select: {
                id: true,
                name: true,
                casNumber: true,
              },
            },
          },
        })
      : [];

    // Collect unique rule IDs to find cascade triggers
    const ruleIds = [...new Set(matchedRuleSubstances.map((rs) => rs.ruleId))];

    // Fetch cascade triggers for these rules that affect the tenant
    const cascadeTriggers = ruleIds.length > 0
      ? await prisma.cascadeTrigger.findMany({
          where: {
            ruleId: { in: ruleIds },
            graph: { tenantId },
          },
          include: {
            impacts: {
              include: {
                node: {
                  select: {
                    id: true,
                    nodeType: true,
                    label: true,
                    entityId: true,
                  },
                },
              },
            },
            rule: {
              select: {
                id: true,
                jurisdiction: true,
                ruleType: true,
                description: true,
              },
            },
          },
          orderBy: { severity: "desc" },
        })
      : [];

    // Compute severity breakdown
    const severityCounts: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    };

    for (const trigger of cascadeTriggers) {
      const sev = trigger.severity as string;
      if (sev in severityCounts) {
        severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
      }
    }

    // Compute jurisdiction breakdown
    const jurisdictionSet = new Set<string>();
    for (const rs of matchedRuleSubstances) {
      jurisdictionSet.add(rs.rule.jurisdiction);
    }

    // Compute rule type breakdown
    const ruleTypeSet = new Set<string>();
    for (const rs of matchedRuleSubstances) {
      ruleTypeSet.add(rs.rule.ruleType);
    }

    // Map triggers to impacts that specifically reference this product
    const productImpacts = cascadeTriggers.flatMap((trigger) =>
      trigger.impacts
        .filter(
          (impact) =>
            impact.node.nodeType === "PRODUCT" &&
            impact.node.entityId === productId
        )
        .map((impact) => ({
          triggerId: trigger.id,
          triggerTitle: trigger.title,
          triggerSeverity: trigger.severity,
          impactId: impact.id,
          impactType: impact.impactType,
          description: impact.description,
          financialImpact: impact.financialImpact,
          timelineImpact: impact.timelineImpact,
          reformRequired: impact.reformRequired,
          reformCost: impact.reformCost,
          priority: impact.priority,
          node: impact.node,
        }))
    );

    // Build ingredient-level exposure mapping
    const ingredientExposure = ingredientIds.length > 0
      ? await prisma.ingredient.findMany({
          where: { id: { in: ingredientIds } },
          select: {
            id: true,
            name: true,
            casNumber: true,
            category: true,
            allergenFlags: true,
            ruleSubstances: {
              where: { isMatched: true },
              select: {
                id: true,
                substanceName: true,
                substanceType: true,
                threshold: true,
                thresholdUnit: true,
                matchConfidence: true,
                matchMethod: true,
                rule: {
                  select: {
                    id: true,
                    jurisdiction: true,
                    ruleType: true,
                    description: true,
                    effectiveDate: true,
                    complianceDate: true,
                  },
                },
              },
            },
          },
        })
      : [];

    const tenantLogger = createTenantLogger(tenantId, userId);
    tenantLogger.info(
      {
        userId,
        role,
        productId,
        ingredientCount: ingredientIds.length,
        matchedSubstanceCount: matchedRuleSubstances.length,
        triggerCount: cascadeTriggers.length,
        impactCount: productImpacts.length,
        durationMs: Date.now() - requestStart,
        action: "product_exposure",
      },
      "Retrieved product regulatory exposure"
    );

    return NextResponse.json({
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        category: product.category,
        brand: product.brand,
        markets: product.markets,
        retailers: product.retailers,
      },
      currentFormulation: currentFormulationLink
        ? {
            formulationId: currentFormulationLink.formulation.id,
            name: currentFormulationLink.formulation.name,
            version: currentFormulationLink.formulation.version,
            ingredientCount: currentFormulationLink.formulation.items.length,
          }
        : null,
      exposure: {
        matchedRuleSubstances: matchedRuleSubstances.map((rs) => ({
          id: rs.id,
          substanceName: rs.substanceName,
          substanceType: rs.substanceType,
          casNumber: rs.casNumber,
          threshold: rs.threshold,
          thresholdUnit: rs.thresholdUnit,
          matchConfidence: rs.matchConfidence,
          matchMethod: rs.matchMethod,
          ingredient: rs.ingredient,
          rule: rs.rule,
        })),
        cascadeTriggers: cascadeTriggers.map((trigger) => ({
          id: trigger.id,
          title: trigger.title,
          description: trigger.description,
          severity: trigger.severity,
          triggerType: trigger.triggerType,
          status: trigger.status,
          cascadeDepth: trigger.cascadeDepth,
          cascadeBreadth: trigger.cascadeBreadth,
          totalSkusAffected: trigger.totalSkusAffected,
          estimatedCostMin: trigger.estimatedCostMin,
          estimatedCostMax: trigger.estimatedCostMax,
          deadlineDate: trigger.deadlineDate,
          rule: trigger.rule,
          impactCount: trigger.impacts.length,
        })),
        productImpacts,
        ingredientExposure: ingredientExposure.map((ie) => ({
          id: ie.id,
          name: ie.name,
          casNumber: ie.casNumber,
          category: ie.category,
          allergenFlags: ie.allergenFlags,
          matchedRuleCount: ie.ruleSubstances.length,
          ruleSubstances: ie.ruleSubstances,
        })),
      },
      summary: {
        totalMatchedSubstances: matchedRuleSubstances.length,
        totalTriggers: cascadeTriggers.length,
        totalProductImpacts: productImpacts.length,
        severityBreakdown: severityCounts,
        jurisdictions: Array.from(jurisdictionSet),
        ruleTypes: Array.from(ruleTypeSet),
        ingredientsWithExposure: ingredientExposure.filter((ie) => ie.ruleSubstances.length > 0).length,
        ingredientsWithoutExposure: ingredientExposure.filter((ie) => ie.ruleSubstances.length === 0).length,
      },
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - requestStart;

    if (error instanceof CascadaError) {
      logger.warn(
        { err: error, code: error.code, statusCode: error.statusCode, durationMs, action: "product_exposure_failed" },
        error.message
      );
      return NextResponse.json(error.toJSON(), { status: error.statusCode });
    }

    if (error instanceof ZodError) {
      const validationError = formatZodError(error);
      return NextResponse.json(validationError.toJSON(), { status: validationError.statusCode });
    }

    const err = toError(error);
    logger.error({ err, durationMs, action: "product_exposure_error" }, "Unexpected error retrieving product exposure");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to retrieve product regulatory exposure" } },
      { status: 500 }
    );
  }
}
