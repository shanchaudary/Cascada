// GET /api/dashboard/exposure-by-product — Regulatory exposure broken down by product
// For each product: matched RuleSubstances, active triggers, reformulation cost,
// annual revenue at risk, severity distribution. Supports pagination + category filter.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/errors";
import { createTenantLogger } from "@/lib/logger";
import type { Severity, ImpactType, TriggerStatus } from "@prisma/client";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Query param schema
// ---------------------------------------------------------------------------

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  category: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface SeverityBucket {
  severity: Severity;
  count: number;
}

interface ProductExposure {
  productId: string;
  productName: string;
  sku: string;
  category: string | null;
  brand: string | null;
  matchedRuleSubstances: number;
  activeTriggerCount: number;
  reformulationCost: number;
  annualRevenueAtRisk: number;
  severityDistribution: SeverityBucket[];
}

interface ExposureByProductResponse {
  products: ProductExposure[];
  totalProducts: number;
  page: number;
  limit: number;
  totalPages: number;
  totalReformulationCost: number;
  totalRevenueAtRisk: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: TriggerStatus[] = [
  "DETECTED",
  "ANALYZING",
  "IMPACT_ASSESSED",
  "DECISION_PACKAGE_READY",
  "DECISION_MADE",
  "WORKFLOW_STARTED",
];

const REFORM_IMPACT_TYPES: ImpactType[] = [
  "REFORMULATION_REQUIRED",
  "REFORMULATION_COST",
];

const ALL_SEVERITIES: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const session = await auth();

  if (!session?.user) {
    throw new AuthenticationError("Session required to access product exposure");
  }

  const userObj = session.user as Record<string, unknown>;
  const tenantId = userObj["tenantId"] as string | undefined;

  if (!tenantId) {
    throw new AuthorizationError("Tenant context required for product exposure");
  }

  const log = createTenantLogger(tenantId, userObj["id"] as string | undefined);

  // Validate query parameters
  const { searchParams } = new URL(request.url);
  const parseResult = querySchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    category: searchParams.get("category") ?? undefined,
  });

  if (!parseResult.success) {
    throw new ValidationError(
      parseResult.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }))
    );
  }

  const { page, limit, category } = parseResult.data;
  const skip = (page - 1) * limit;

  log.info(
    { component: "dashboard", operation: "exposure-by-product", page, limit, category },
    "Fetching exposure by product"
  );

  try {
    // -----------------------------------------------------------------------
    // 1. Count total matching products for pagination
    // -----------------------------------------------------------------------
    const productWhere = {
      tenantId,
      isActive: true,
      ...(category ? { category } : {}),
    };

    const totalProducts = await prisma.product.count({ where: productWhere });

    // -----------------------------------------------------------------------
    // 2. Fetch paginated products with formulations and ingredients
    // -----------------------------------------------------------------------
    const products = await prisma.product.findMany({
      where: productWhere,
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        brand: true,
        annualRevenue: true,
        formulations: {
          where: { isCurrent: true },
          select: {
            formulation: {
              select: {
                items: {
                  select: {
                    ingredientId: true,
                  },
                },
              },
            },
          },
        },
      },
      skip,
      take: limit,
      orderBy: { name: "asc" },
    });

    if (products.length === 0) {
      const emptyResponse: ExposureByProductResponse = {
        products: [],
        totalProducts: 0,
        page,
        limit,
        totalPages: 0,
        totalReformulationCost: 0,
        totalRevenueAtRisk: 0,
        generatedAt: new Date().toISOString(),
      };
      return NextResponse.json(emptyResponse, { status: 200 });
    }

    // Collect all ingredient IDs across all products for batch queries
    const productIngredientMap = new Map<string, Set<string>>();
    const allIngredientIds = new Set<string>();

    for (const product of products) {
      const ingredientIds = new Set<string>();
      for (const pf of product.formulations) {
        for (const item of pf.formulation.items) {
          ingredientIds.add(item.ingredientId);
          allIngredientIds.add(item.ingredientId);
        }
      }
      productIngredientMap.set(product.id, ingredientIds);
    }

    // -----------------------------------------------------------------------
    // 3. Find matched RuleSubstances for these ingredients
    // -----------------------------------------------------------------------
    const ruleSubstances = await prisma.ruleSubstance.findMany({
      where: {
        ingredientId: { in: [...allIngredientIds] },
        isMatched: true,
      },
      select: {
        ingredientId: true,
        ruleId: true,
      },
    });

    // Build ingredient → ruleSubstance count map
    const ingredientRuleCount = new Map<string, number>();
    for (const rs of ruleSubstances) {
      if (rs.ingredientId) {
        ingredientRuleCount.set(
          rs.ingredientId,
          (ingredientRuleCount.get(rs.ingredientId) ?? 0) + 1
        );
      }
    }

    // -----------------------------------------------------------------------
    // 4. Find CascadeImpacts on PRODUCT nodes for these products
    // -----------------------------------------------------------------------
    const productIds = products.map((p) => p.id);

    // Get PRODUCT cascade nodes for these products in the tenant's graph
    const productNodes = await prisma.cascadeNode.findMany({
      where: {
        nodeType: "PRODUCT",
        entityId: { in: productIds },
        graph: { tenantId },
      },
      select: {
        id: true,
        entityId: true,
        impacts: {
          where: {
            trigger: {
              status: { in: ACTIVE_STATUSES },
            },
          },
          select: {
            impactType: true,
            financialImpact: true,
            reformCost: true,
            trigger: {
              select: {
                severity: true,
                totalSkusAffected: true,
                estimatedCostMin: true,
                estimatedCostMax: true,
              },
            },
          },
        },
      },
    });

    // Build product-node-id → product-id map and product-id → impacts
    const productIdToImpacts = new Map<
      string,
      Array<{
        impactType: ImpactType;
        financialImpact: number | null;
        reformCost: number | null;
        severity: Severity;
      }>
    >();

    for (const node of productNodes) {
      const productId = node.entityId;
      const existing = productIdToImpacts.get(productId) ?? [];
      for (const impact of node.impacts) {
        existing.push({
          impactType: impact.impactType,
          financialImpact: impact.financialImpact
            ? Number(impact.financialImpact)
            : null,
          reformCost: impact.reformCost ? Number(impact.reformCost) : null,
          severity: impact.trigger.severity,
        });
      }
      productIdToImpacts.set(productId, existing);
    }

    // -----------------------------------------------------------------------
    // 5. Build product exposure records
    // -----------------------------------------------------------------------
    const productExposures: ProductExposure[] = products.map((product) => {
      const ingredientIds = productIngredientMap.get(product.id) ?? new Set();
      const matchedRuleSubstances = [...ingredientIds].reduce(
        (sum, ingId) => sum + (ingredientRuleCount.get(ingId) ?? 0),
        0
      );

      const impacts = productIdToImpacts.get(product.id) ?? [];
      const activeTriggerCount = impacts.length;

      const reformulationCost = impacts
        .filter((i) => REFORM_IMPACT_TYPES.includes(i.impactType))
        .reduce((sum, i) => sum + (i.reformCost ?? 0), 0);

      const annualRevenueAtRisk = impacts.reduce(
        (sum, i) => sum + (i.financialImpact ?? 0),
        0
      );

      // Severity distribution
      const severityCounts = new Map<Severity, number>();
      for (const i of impacts) {
        severityCounts.set(i.severity, (severityCounts.get(i.severity) ?? 0) + 1);
      }

      const severityDistribution: SeverityBucket[] = ALL_SEVERITIES.map(
        (severity) => ({
          severity,
          count: severityCounts.get(severity) ?? 0,
        })
      );

      return {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        category: product.category,
        brand: product.brand,
        matchedRuleSubstances,
        activeTriggerCount,
        reformulationCost,
        annualRevenueAtRisk,
        severityDistribution,
      };
    });

    // Sort by annual revenue at risk descending
    productExposures.sort((a, b) => b.annualRevenueAtRisk - a.annualRevenueAtRisk);

    const totalPages = Math.ceil(totalProducts / limit);
    const totalReformulationCost = productExposures.reduce(
      (sum, p) => sum + p.reformulationCost,
      0
    );
    const totalRevenueAtRisk = productExposures.reduce(
      (sum, p) => sum + p.annualRevenueAtRisk,
      0
    );

    const response: ExposureByProductResponse = {
      products: productExposures,
      totalProducts,
      page,
      limit,
      totalPages,
      totalReformulationCost,
      totalRevenueAtRisk,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    log.error(
      { err: error, component: "dashboard", operation: "exposure-by-product" },
      "Failed to compute exposure by product"
    );
    throw error;
  }
}
