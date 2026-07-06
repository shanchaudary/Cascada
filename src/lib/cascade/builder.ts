// Cascada — Cascade Graph Builder
// Constructs the dependency graph for a tenant from their actual data:
//   Ingredients → Formulations → Products → Customers
//   Ingredients → Suppliers
//   Products → Regulations (via matched RuleSubstances)
//   Customers → Requirements (retailer mandates)
//
// This is the heart of the cascade engine. Without a complete, accurate graph,
// cascade traversal cannot trace regulatory impact through the supply chain.
// The builder reads ALL tenant data from PostgreSQL and creates CascadeNode
// and CascadeEdge records that represent the actual business relationships.

import { prisma, withTenant } from "@/lib/db";
import { createCascadeLogger } from "@/lib/logger";
import { CascadeGraphError } from "@/lib/errors";
import { CASCADE_CONFIG } from "@/lib/constants";
import type {
  CascadeNodeType,
  CascadeEdgeType,
} from "@prisma/client";
import type {
  CascadeNodeProperties,
  CascadeEdgeProperties,
} from "@/types/cascade";

// ============================================================================
// Types
// ============================================================================

export interface GraphBuildResult {
  graphId: string;
  tenantId: string;
  version: number;
  nodeCount: number;
  edgeCount: number;
  nodesByType: Record<CascadeNodeType, number>;
  edgesByType: Record<CascadeEdgeType, number>;
  buildTimeMs: number;
  isIncremental: boolean;
}

export interface GraphBuildOptions {
  fullRebuild?: boolean;
  includeSuppliers?: boolean;
  includeRetailerRequirements?: boolean;
  maxNodes?: number;
}

interface NodeBuildItem {
  nodeType: CascadeNodeType;
  entityId: string;
  label: string;
  properties: CascadeNodeProperties;
  riskScore: number | null;
}

interface EdgeBuildItem {
  sourceNodeType: CascadeNodeType;
  sourceEntityId: string;
  targetNodeType: CascadeNodeType;
  targetEntityId: string;
  edgeType: CascadeEdgeType;
  properties: CascadeEdgeProperties;
  strength: number | null;
}

// ============================================================================
// Graph Builder
// ============================================================================

const logger = createCascadeLogger("builder");

/**
 * Build (or rebuild) the cascade graph for a tenant.
 *
 * The graph represents the actual supply chain and regulatory dependencies:
 * - INGREDIENT → CONTAINS → FORMULATION (ingredient is part of recipe)
 * - FORMULATION → PRODUCED_FROM → PRODUCT (product is made from recipe)
 * - PRODUCT → SOLD_TO → CUSTOMER (product sold to customer/retailer)
 * - PRODUCT → SUBJECT_TO → REGULATION (product affected by regulation)
 * - INGREDIENT → SUPPLIED_BY → SUPPLIER (ingredient from supplier)
 * - CUSTOMER → REQUIRES → RETAILER_REQUIREMENT (customer has spec demands)
 *
 * Full rebuild: drops all existing nodes/edges and rebuilds from scratch.
 * Incremental: only adds/updates changed entities since last rebuild.
 */
export async function buildCascadeGraph(
  tenantId: string,
  options: GraphBuildOptions = {}
): Promise<GraphBuildResult> {
  const startTime = Date.now();
  const {
    fullRebuild = false,
    includeSuppliers = true,
    includeRetailerRequirements = true,
    maxNodes = CASCADE_CONFIG.MAX_TRAVERSAL_DEPTH * 500,
  } = options;

  logger.info({ tenantId, fullRebuild, includeSuppliers, includeRetailerRequirements }, "Starting cascade graph build");

  try {
    return await withTenant(tenantId, async () => {
      // Step 1: Get or create the CascadeGraph record
      const existingGraph = await prisma.cascadeGraph.findFirst({
        where: { tenantId },
        orderBy: { version: "desc" },
      });

      const isIncremental = !fullRebuild && existingGraph !== null;
      const graphId = existingGraph?.id ?? "";

      if (fullRebuild && existingGraph) {
        // Delete all nodes and edges for a clean rebuild
        await prisma.cascadeEdge.deleteMany({ where: { graphId: existingGraph.id } });
        await prisma.cascadeNode.deleteMany({ where: { graphId: existingGraph.id } });
        logger.info({ graphId: existingGraph.id }, "Cleared existing graph for full rebuild");
      }

      const graph = existingGraph
        ? await prisma.cascadeGraph.update({
            where: { id: existingGraph.id },
            data: {
              version: fullRebuild ? existingGraph.version + 1 : existingGraph.version,
              lastRebuiltAt: new Date(),
            },
          })
        : await prisma.cascadeGraph.create({
            data: {
              tenantId,
              version: 1,
              lastRebuiltAt: new Date(),
            },
          });

      const currentGraphId = graph.id;

      // Step 2: Collect all nodes and edges from tenant data
      const nodes: NodeBuildItem[] = [];
      const edges: EdgeBuildItem[] = [];

      // Build ingredient nodes
      await buildIngredientNodes(tenantId, nodes);

      // Build formulation nodes and INGREDIENT → CONTAINS → FORMULATION edges
      await buildFormulationNodesAndEdges(tenantId, nodes, edges);

      // Build product nodes and FORMULATION → PRODUCED_FROM → PRODUCT edges
      await buildProductNodesAndEdges(tenantId, nodes, edges);

      // Build customer nodes and PRODUCT → SOLD_TO → CUSTOMER edges
      await buildCustomerNodesAndEdges(tenantId, nodes, edges);

      // Build regulation nodes and PRODUCT → SUBJECT_TO → REGULATION edges
      await buildRegulationNodesAndEdges(tenantId, nodes, edges);

      // Optionally build supplier nodes and INGREDIENT → SUPPLIED_BY → SUPPLIER edges
      if (includeSuppliers) {
        await buildSupplierNodesAndEdges(tenantId, nodes, edges);
      }

      // Optionally build retailer requirement nodes and CUSTOMER → REQUIRES → RETAILER_REQUIREMENT edges
      if (includeRetailerRequirements) {
        await buildRetailerRequirementNodesAndEdges(tenantId, nodes, edges);
      }

      // Step 3: Enforce max nodes limit
      if (nodes.length > maxNodes) {
        logger.warn(
          { tenantId, nodeCount: nodes.length, maxNodes },
          "Graph exceeds max nodes limit, truncating to highest-risk nodes"
        );
        nodes.sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
        nodes.length = maxNodes;
        // Remove edges that reference truncated nodes
        const activeEntityIds = new Set(nodes.map((n) => `${n.nodeType}:${n.entityId}`));
        const filteredEdges = edges.filter(
          (e) =>
            activeEntityIds.has(`${e.sourceNodeType}:${e.sourceEntityId}`) &&
            activeEntityIds.has(`${e.targetNodeType}:${e.targetEntityId}`)
        );
        edges.length = 0;
        edges.push(...filteredEdges);
      }

      // Step 4: Persist nodes to database
      const nodeTypeCounts: Record<string, number> = {};
      for (const node of nodes) {
        nodeTypeCounts[node.nodeType] = (nodeTypeCounts[node.nodeType] ?? 0) + 1;

        await prisma.cascadeNode.upsert({
          where: {
            graphId_nodeType_entityId: {
              graphId: currentGraphId,
              nodeType: node.nodeType,
              entityId: node.entityId,
            },
          },
          create: {
            graphId: currentGraphId,
            nodeType: node.nodeType,
            entityId: node.entityId,
            label: node.label,
            properties: node.properties as object,
            riskScore: node.riskScore,
          },
          update: {
            label: node.label,
            properties: node.properties as object,
            riskScore: node.riskScore,
          },
        });
      }

      // Step 5: Persist edges to database
      const edgeTypeCounts: Record<string, number> = {};
      // Build a lookup for node IDs
      const nodeLookup = new Map<string, string>();
      const graphNodes = await prisma.cascadeNode.findMany({
        where: { graphId: currentGraphId },
        select: { id: true, nodeType: true, entityId: true },
      });
      for (const gn of graphNodes) {
        nodeLookup.set(`${gn.nodeType}:${gn.entityId}`, gn.id);
      }

      for (const edge of edges) {
        const sourceNodeId = nodeLookup.get(`${edge.sourceNodeType}:${edge.sourceEntityId}`);
        const targetNodeId = nodeLookup.get(`${edge.targetNodeType}:${edge.targetEntityId}`);
        if (!sourceNodeId || !targetNodeId) continue;

        edgeTypeCounts[edge.edgeType] = (edgeTypeCounts[edge.edgeType] ?? 0) + 1;

        await prisma.cascadeEdge.create({
          data: {
            graphId: currentGraphId,
            sourceNodeId,
            targetNodeId,
            edgeType: edge.edgeType,
            properties: edge.properties as object,
            strength: edge.strength,
          },
        });
      }

      // Step 6: Update graph metadata
      const totalNodes = Object.values(nodeTypeCounts).reduce((a, b) => a + b, 0);
      const totalEdges = Object.values(edgeTypeCounts).reduce((a, b) => a + b, 0);

      await prisma.cascadeGraph.update({
        where: { id: currentGraphId },
        data: {
          nodeCount: totalNodes,
          edgeCount: totalEdges,
        },
      });

      const buildTimeMs = Date.now() - startTime;
      logger.info(
        {
          graphId: currentGraphId,
          tenantId,
          nodeCount: totalNodes,
          edgeCount: totalEdges,
          buildTimeMs,
          isIncremental,
        },
        "Cascade graph build completed"
      );

      return {
        graphId: currentGraphId,
        tenantId,
        version: graph.version,
        nodeCount: totalNodes,
        edgeCount: totalEdges,
        nodesByType: nodeTypeCounts as Record<CascadeNodeType, number>,
        edgesByType: edgeTypeCounts as Record<CascadeEdgeType, number>,
        buildTimeMs,
        isIncremental,
      };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error building cascade graph";
    logger.error({ tenantId, error: msg }, "Cascade graph build failed");
    throw new CascadeGraphError(msg, { tenantId, fullRebuild });
  }
}

// ============================================================================
// Node Builders
// ============================================================================

/**
 * Build INGREDIENT nodes from the tenant's ingredient records.
 * Risk score is computed from allergen flags, synthetic status, and source type.
 */
async function buildIngredientNodes(
  tenantId: string,
  nodes: NodeBuildItem[]
): Promise<void> {
  const ingredients = await prisma.ingredient.findMany({
    where: { tenantId },
    include: { ruleSubstances: true },
  });

  for (const ingredient of ingredients) {
    // Risk score: higher if ingredient has matched rule substances,
    // allergen flags, or is synthetic from petroleum
    let riskScore = 0;
    if (ingredient.ruleSubstances.length > 0) {
      riskScore += 0.3;
    }
    if (ingredient.allergenFlags.length > 0) {
      riskScore += 0.15;
    }
    if (ingredient.isSynthetic === true) {
      riskScore += 0.1;
    }
    if (ingredient.sourceType === "petroleum") {
      riskScore += 0.15;
    }
    // Cap at 0.7 since ingredients aren't the impact point themselves
    riskScore = Math.min(riskScore, 0.7);

    nodes.push({
      nodeType: "INGREDIENT",
      entityId: ingredient.id,
      label: ingredient.name,
      properties: {
        casNumber: ingredient.casNumber ?? undefined,
        eenumber: ingredient.eenumber ?? undefined,
        category: ingredient.category ?? undefined,
        isSynthetic: ingredient.isSynthetic ?? undefined,
        sourceType: ingredient.sourceType ?? undefined,
        allergenFlags: ingredient.allergenFlags,
      },
      riskScore,
    });
  }
}

/**
 * Build FORMULATION nodes and INGREDIENT → CONTAINS → FORMULATION edges.
 * Each formulation represents a recipe/BOM, and each FormulationItem
 * connects an ingredient to the formulation with concentration data.
 */
async function buildFormulationNodesAndEdges(
  tenantId: string,
  nodes: NodeBuildItem[],
  edges: EdgeBuildItem[]
): Promise<void> {
  const formulations = await prisma.formulation.findMany({
    where: { tenantId },
    include: {
      items: {
        include: { ingredient: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  for (const formulation of formulations) {
    nodes.push({
      nodeType: "FORMULATION",
      entityId: formulation.id,
      label: formulation.name,
      properties: {},
      riskScore: null, // Will be computed during traversal
    });

    // Create edges: INGREDIENT → CONTAINS → FORMULATION
    for (const item of formulation.items) {
      const concentration = item.percentage?.toNumber() ?? null;
      const quantity = item.quantity.toNumber();
      const batchSize = formulation.batchSize ?? 1;

      // Edge strength represents how significant this ingredient is in the formulation
      // Higher concentration = stronger dependency = higher cascade impact
      const strength = concentration !== null
        ? Math.min(concentration / 100, 1)
        : Math.min(quantity / batchSize, 1);

      edges.push({
        sourceNodeType: "INGREDIENT",
        sourceEntityId: item.ingredientId,
        targetNodeType: "FORMULATION",
        targetEntityId: formulation.id,
        edgeType: "CONTAINS",
        properties: {
          concentration: concentration ?? undefined,
          concentrationUnit: concentration !== null ? "%" : item.unit,
          percentage: concentration ?? undefined,
        },
        strength: Math.max(strength, CASCADE_CONFIG.MIN_EDGE_STRENGTH),
      });
    }
  }
}

/**
 * Build PRODUCT nodes and FORMULATION → PRODUCED_FROM → PRODUCT edges.
 * A product may have multiple formulations (version history), but only
 * the current formulation is used for cascade analysis.
 */
async function buildProductNodesAndEdges(
  tenantId: string,
  nodes: NodeBuildItem[],
  edges: EdgeBuildItem[]
): Promise<void> {
  const products = await prisma.product.findMany({
    where: { tenantId, isActive: true },
    include: {
      formulations: {
        where: { isCurrent: true },
        include: { formulation: true },
      },
    },
  });

  for (const product of products) {
    const annualRevenue = product.annualRevenue?.toNumber() ?? null;
    const annualVolume = product.annualVolume?.toNumber() ?? null;

    // Risk score for products based on revenue exposure and market breadth
    let riskScore = 0;
    if (annualRevenue !== null) {
      if (annualRevenue > 10_000_000) riskScore += 0.3;
      else if (annualRevenue > 1_000_000) riskScore += 0.2;
      else if (annualRevenue > 100_000) riskScore += 0.1;
    }
    if (product.markets.length > 5) riskScore += 0.15;
    if (product.retailers.length > 3) riskScore += 0.1;
    riskScore = Math.min(riskScore, 0.8);

    nodes.push({
      nodeType: "PRODUCT",
      entityId: product.id,
      label: product.name,
      properties: {
        sku: product.sku,
        brand: product.brand ?? undefined,
        markets: product.markets,
        retailers: product.retailers,
        annualRevenue: annualRevenue ?? undefined,
        annualVolume: annualVolume ?? undefined,
      },
      riskScore,
    });

    // Create edges: FORMULATION → PRODUCED_FROM → PRODUCT
    for (const pf of product.formulations) {
      edges.push({
        sourceNodeType: "FORMULATION",
        sourceEntityId: pf.formulationId,
        targetNodeType: "PRODUCT",
        targetEntityId: product.id,
        edgeType: "PRODUCED_FROM",
        properties: {},
        strength: 0.9, // High strength: product directly depends on formulation
      });
    }
  }
}

/**
 * Build CUSTOMER nodes and PRODUCT → SOLD_TO → CUSTOMER edges.
 * Customer relationships determine revenue exposure when a product
 * is affected by a regulation.
 */
async function buildCustomerNodesAndEdges(
  tenantId: string,
  nodes: NodeBuildItem[],
  edges: EdgeBuildItem[]
): Promise<void> {
  const customers = await prisma.customer.findMany({
    where: { tenantId },
    include: {
      customerProducts: {
        include: { product: true },
      },
    },
  });

  for (const customer of customers) {
    nodes.push({
      nodeType: "CUSTOMER",
      entityId: customer.id,
      label: customer.name,
      properties: {
        customerType: customer.type,
        requirements: (customer.requirements ?? {}) as Record<string, unknown>,
      },
      riskScore: null,
    });

    // Create edges: PRODUCT → SOLD_TO → CUSTOMER
    for (const cp of customer.customerProducts) {
      if (!cp.isActive) continue;

      const specProps = cp.specRequirements as Record<string, unknown> | null;
      const contractExpiry = specProps?.['contractExpiry'] as string | undefined;
      const volumeCommitment = specProps?.['volumeCommitment'] as number | undefined;

      edges.push({
        sourceNodeType: "PRODUCT",
        sourceEntityId: cp.productId,
        targetNodeType: "CUSTOMER",
        targetEntityId: customer.id,
        edgeType: "SOLD_TO",
        properties: {
          contractExpiry,
          volumeCommitment,
        },
        strength: 0.7, // Default strength for customer relationships
      });
    }
  }
}

/**
 * Build REGULATION nodes and PRODUCT → SUBJECT_TO → REGULATION edges.
 * This is where the cascade originates — a regulation affects ingredients,
 * which propagates through formulations, products, and customers.
 */
async function buildRegulationNodesAndEdges(
  tenantId: string,
  nodes: NodeBuildItem[],
  edges: EdgeBuildItem[]
): Promise<void> {
  // Find all rules that have matched substances linked to this tenant's ingredients
  const matchedSubstances = await prisma.ruleSubstance.findMany({
    where: {
      isMatched: true,
      ingredient: { tenantId },
    },
    include: {
      rule: {
        include: { source: true },
      },
      ingredient: true,
    },
  });

  // Group by rule to avoid duplicate regulation nodes
  const rulesByRuleId = new Map<string, {
    ruleId: string;
    jurisdiction: string;
    ruleType: string;
    description: string;
    effectiveDate: Date | null;
    complianceDate: Date | null;
    sourceName: string;
    productIds: Set<string>;
  }>();

  for (const rs of matchedSubstances) {
    const rule = rs.rule;

    // Find products that contain this ingredient
    if (!rs.ingredientId) continue;

    const formulationItems = await prisma.formulationItem.findMany({
      where: { ingredientId: rs.ingredientId },
      include: {
        formulation: {
          include: {
            products: {
              where: { isCurrent: true },
              include: { product: true },
            },
          },
        },
      },
    });

    const productIds = new Set<string>();
    for (const fi of formulationItems) {
      for (const pf of fi.formulation.products) {
        if (pf.product && pf.product.tenantId === tenantId && pf.product.isActive) {
          productIds.add(pf.product.id);
        }
      }
    }

    if (!rulesByRuleId.has(rule.id)) {
      rulesByRuleId.set(rule.id, {
        ruleId: rule.id,
        jurisdiction: rule.jurisdiction,
        ruleType: rule.ruleType,
        description: rule.description,
        effectiveDate: rule.effectiveDate,
        complianceDate: rule.complianceDate,
        sourceName: rule.source.name,
        productIds,
      });
    } else {
      const existing = rulesByRuleId.get(rule.id)!;
      for (const pid of productIds) {
        existing.productIds.add(pid);
      }
    }
  }

  // Create REGULATION nodes and SUBJECT_TO edges
  for (const [, ruleData] of rulesByRuleId) {
    // Regulation risk score based on rule type severity
    const ruleTypeRisk: Record<string, number> = {
      BAN: 1.0,
      MARKET_WITHDRAWAL: 0.9,
      PHASE_OUT: 0.8,
      CONCENTRATION_LIMIT: 0.6,
      WARNING_LABEL: 0.5,
      DISCLOSURE: 0.4,
      CERTIFICATION: 0.3,
      REPORTING: 0.25,
      INGREDIENT_REVIEW: 0.2,
    };
    const riskScore = ruleTypeRisk[ruleData.ruleType] ?? 0.3;

    nodes.push({
      nodeType: "REGULATION",
      entityId: ruleData.ruleId,
      label: `${ruleData.sourceName} [${ruleData.ruleType}]`,
      properties: {
        ruleType: ruleData.ruleType,
        jurisdiction: ruleData.jurisdiction,
        effectiveDate: ruleData.effectiveDate?.toISOString(),
        complianceDate: ruleData.complianceDate?.toISOString(),
      },
      riskScore,
    });

    // Create edges: PRODUCT → SUBJECT_TO → REGULATION
    for (const productId of ruleData.productIds) {
      edges.push({
        sourceNodeType: "PRODUCT",
        sourceEntityId: productId,
        targetNodeType: "REGULATION",
        targetEntityId: ruleData.ruleId,
        edgeType: "SUBJECT_TO",
        properties: {
          threshold: undefined,
          thresholdUnit: undefined,
        },
        strength: riskScore * 0.8, // Edge strength proportional to regulation severity
      });
    }
  }
}

/**
 * Build SUPPLIER nodes and INGREDIENT → SUPPLIED_BY → SUPPLIER edges.
 * Supplier disruption is a cascade trigger source (e.g., if a supplier
 * loses certification or goes out of business).
 */
async function buildSupplierNodesAndEdges(
  tenantId: string,
  nodes: NodeBuildItem[],
  edges: EdgeBuildItem[]
): Promise<void> {
  const suppliers = await prisma.supplier.findMany({
    where: { tenantId },
  });

  for (const supplier of suppliers) {
    const riskScore = supplier.riskScore?.toNumber() ?? null;

    nodes.push({
      nodeType: "SUPPLIER",
      entityId: supplier.id,
      label: supplier.name,
      properties: {
        certifications: supplier.certifications,
        riskScore: riskScore ?? undefined,
      },
      riskScore,
    });

    // Create edges: INGREDIENT → SUPPLIED_BY → SUPPLIER
    for (const ingredientId of supplier.ingredientIds) {
      edges.push({
        sourceNodeType: "INGREDIENT",
        sourceEntityId: ingredientId,
        targetNodeType: "SUPPLIER",
        targetEntityId: supplier.id,
        edgeType: "SUPPLIED_BY",
        properties: {
          leadTimeDays: undefined,
          minimumOrderQuantity: undefined,
          costPerUnit: undefined,
        },
        strength: 0.5, // Default supply relationship strength
      });
    }
  }
}

/**
 * Build RETAILER_REQUIREMENT nodes and CUSTOMER → REQUIRES → RETAILER_REQUIREMENT edges.
 * Retailer mandates (e.g., Walmart's banned substance list) are separate from
 * government regulations and create additional compliance obligations.
 */
async function buildRetailerRequirementNodesAndEdges(
  tenantId: string,
  nodes: NodeBuildItem[],
  edges: EdgeBuildItem[]
): Promise<void> {
  const customers = await prisma.customer.findMany({
    where: {
      tenantId,
      type: "RETAILER",
      requirements: { not: null as unknown as undefined },
    },
  });

  for (const customer of customers) {
    const requirements = customer.requirements as Record<string, unknown> | null;
    if (!requirements) continue;

    // Each retailer may have multiple requirement categories
    const requirementCategories = Object.keys(requirements);
    for (const category of requirementCategories) {
      const reqId = `${customer.id}:${category}`;

      nodes.push({
        nodeType: "RETAILER_REQUIREMENT",
        entityId: reqId,
        label: `${customer.name}: ${category}`,
        properties: {
          category,
          requirements: requirements[category] as Record<string, unknown>,
        },
        riskScore: 0.5, // Default risk for retailer mandates
      });

      // Create edge: CUSTOMER → REQUIRES → RETAILER_REQUIREMENT
      edges.push({
        sourceNodeType: "CUSTOMER",
        sourceEntityId: customer.id,
        targetNodeType: "RETAILER_REQUIREMENT",
        targetEntityId: reqId,
        edgeType: "REQUIRES",
        properties: {},
        strength: 0.8, // Retailer requirements are high-strength dependencies
      });
    }
  }
}

// ============================================================================
// Graph Stats
// ============================================================================

/**
 * Get statistics about the current cascade graph for a tenant.
 */
export async function getGraphStats(tenantId: string): Promise<{
  graphId: string | null;
  version: number;
  nodeCount: number;
  edgeCount: number;
  lastRebuiltAt: Date | null;
  nodesByType: Record<string, number>;
  edgesByType: Record<string, number>;
}> {
  const graph = await prisma.cascadeGraph.findFirst({
    where: { tenantId },
    orderBy: { version: "desc" },
  });

  if (!graph) {
    return {
      graphId: null,
      version: 0,
      nodeCount: 0,
      edgeCount: 0,
      lastRebuiltAt: null,
      nodesByType: {},
      edgesByType: {},
    };
  }

  const [nodesByType, edgesByType] = await Promise.all([
    prisma.cascadeNode.groupBy({
      by: ["nodeType"],
      where: { graphId: graph.id },
      _count: { nodeType: true },
    }),
    prisma.cascadeEdge.groupBy({
      by: ["edgeType"],
      where: { graphId: graph.id },
      _count: { edgeType: true },
    }),
  ]);

  return {
    graphId: graph.id,
    version: graph.version,
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    lastRebuiltAt: graph.lastRebuiltAt,
    nodesByType: Object.fromEntries(nodesByType.map((n) => [n.nodeType, n._count.nodeType])),
    edgesByType: Object.fromEntries(edgesByType.map((e) => [e.edgeType, e._count.edgeType])),
  };
}

/**
 * Get the full cascade graph for a tenant, including all nodes and edges.
 * Used for visualization and debugging.
 */
export async function getCascadeGraph(tenantId: string): Promise<{
  graph: {
    id: string;
    version: number;
    nodeCount: number;
    edgeCount: number;
    lastRebuiltAt: Date;
  };
  nodes: Array<{
    id: string;
    nodeType: CascadeNodeType;
    entityId: string;
    label: string;
    properties: CascadeNodeProperties;
    riskScore: number | null;
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: CascadeEdgeType;
    properties: CascadeEdgeProperties;
    strength: number | null;
  }>;
} | null> {
  const graph = await prisma.cascadeGraph.findFirst({
    where: { tenantId },
    orderBy: { version: "desc" },
    include: {
      nodes: {
        orderBy: { nodeType: "asc" },
      },
      edges: {
        include: {
          sourceNode: { select: { nodeType: true, entityId: true, label: true } },
          targetNode: { select: { nodeType: true, entityId: true, label: true } },
        },
      },
    },
  });

  if (!graph) return null;

  return {
    graph: {
      id: graph.id,
      version: graph.version,
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
      lastRebuiltAt: graph.lastRebuiltAt,
    },
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      nodeType: n.nodeType,
      entityId: n.entityId,
      label: n.label,
      properties: n.properties as CascadeNodeProperties,
      riskScore: n.riskScore?.toNumber() ?? null,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      edgeType: e.edgeType,
      properties: e.properties as CascadeEdgeProperties,
      strength: e.strength?.toNumber() ?? null,
    })),
  };
}
