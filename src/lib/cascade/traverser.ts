// Cascada — Cascade Traverser
// Multi-hop graph traversal that traces regulatory impact through the supply chain.
//
// When a regulation affects an ingredient, the cascade traverses:
//   Ingredient → Formulation → Product → Customer
//   Ingredient → Supplier
//   Product → Regulation
//   Customer → Retailer Requirement
//
// The traverser uses breadth-first search (BFS) with configurable depth limits,
// edge type filters, and direction controls. It produces TraversalPath records
// that capture every node and edge visited, enabling downstream scoring and
// cost estimation.
//
// Key design decisions:
// - BFS over DFS: BFS finds shortest paths first, which represent the most
//   direct impact routes. DFS would find deep paths that may not be actionable.
// - Configurable edge type filters: Not all edges matter for every trigger.
//   A ban on Red Dye 40 doesn't follow SUPPLIED_BY edges to suppliers.
// - Direction matters: For regulation triggers, we traverse OUTGOING from
//   the regulation node. For supplier disruption, we traverse INCOMING to
//   find affected ingredients.

import { prisma, withTenant } from "@/lib/db";
import { createCascadeLogger } from "@/lib/logger";
import { CascadeTraversalError } from "@/lib/errors";
import { CASCADE_CONFIG } from "@/lib/constants";
import type {
  CascadeNodeType,
  CascadeEdgeType,
  Severity,
  TriggerType,
  TriggerStatus,
} from "@prisma/client";
import type {
  TraversalPath,
  TraversalResult,
  GraphTraversalQuery,
} from "@/types/cascade";

// ============================================================================
// Types
// ============================================================================

export interface TraverseOptions {
  maxDepth?: number;
  minStrength?: number;
  edgeTypes?: CascadeEdgeType[];
  nodeTypes?: CascadeNodeType[];
  direction?: "outgoing" | "incoming" | "both";
}

export interface TriggerTraversalInput {
  triggerId: string;
  ruleId: string;
  tenantId: string;
  triggerType: TriggerType;
  severity: Severity;
  affectedNodeIds: string[];
}

export interface TriggerTraversalResult {
  triggerId: string;
  traversalResult: TraversalResult;
  cascadeDepth: number;
  cascadeBreadth: number;
  totalSkusAffected: number;
  affectedNodeIds: string[];
}

// ============================================================================
// Traverser Implementation
// ============================================================================

const logger = createCascadeLogger("traverser");

/**
 * Execute a multi-hop cascade traversal starting from one or more nodes.
 *
 * The algorithm:
 * 1. Start from the given node IDs
 * 2. For each node, follow edges matching the specified types and direction
 * 3. Track visited nodes to prevent cycles
 * 4. Record complete paths from start to each reachable node
 * 5. Stop at maxDepth or when no new nodes are reachable
 *
 * Returns all paths found, the set of affected nodes, and depth/breadth metrics.
 */
export async function traverseCascade(
  tenantId: string,
  query: GraphTraversalQuery,
  options: TraverseOptions = {}
): Promise<TraversalResult> {
  const {
    maxDepth = CASCADE_CONFIG.MAX_TRAVERSAL_DEPTH,
    minStrength = CASCADE_CONFIG.MIN_EDGE_STRENGTH,
    direction = "outgoing",
  } = options;

  logger.debug(
    {
      tenantId,
      startNodeCount: query.startNodeIds.length,
      maxDepth,
      direction,
      edgeTypes: query.edgeTypes,
    },
    "Starting cascade traversal"
  );

  try {
    return await withTenant(tenantId, async () => {
      const graph = await prisma.cascadeGraph.findFirst({
        where: { tenantId },
        orderBy: { version: "desc" },
      });

      if (!graph) {
        throw new CascadeTraversalError("No cascade graph found for tenant", { tenantId });
      }

      // Load all nodes and edges for the graph into memory for efficient traversal
      const [allNodes, allEdges] = await Promise.all([
        prisma.cascadeNode.findMany({
          where: { graphId: graph.id },
        }),
        prisma.cascadeEdge.findMany({
          where: {
            graphId: graph.id,
            ...(query.edgeTypes ? { edgeType: { in: query.edgeTypes } } : {}),
          },
        }),
      ]);

      // Build adjacency lists for fast lookup
      const nodeMap = new Map(allNodes.map((n) => [n.id, n]));
      const outgoingEdges = new Map<string, typeof allEdges>();
      const incomingEdges = new Map<string, typeof allEdges>();

      for (const edge of allEdges) {
        // Filter by min strength
        if (edge.strength && edge.strength.toNumber() < minStrength) continue;
        // Filter by edge types from query
        if (query.edgeTypes && !query.edgeTypes.includes(edge.edgeType)) continue;

        // Outgoing: source → target
        if (direction === "outgoing" || direction === "both") {
          const list = outgoingEdges.get(edge.sourceNodeId) ?? [];
          list.push(edge);
          outgoingEdges.set(edge.sourceNodeId, list);
        }
        // Incoming: target → source (reverse traversal)
        if (direction === "incoming" || direction === "both") {
          const list = incomingEdges.get(edge.targetNodeId) ?? [];
          list.push(edge);
          incomingEdges.set(edge.targetNodeId, list);
        }
      }

      // BFS traversal
      const paths: TraversalPath[] = [];
      const affectedNodes = new Set<string>();
      let maxDepthFound = 0;

      for (const startNodeId of query.startNodeIds) {
        const startNode = nodeMap.get(startNodeId);
        if (!startNode) {
          logger.warn({ startNodeId }, "Start node not found in graph, skipping");
          continue;
        }

        // Filter by node types if specified
        if (query.nodeTypes && !query.nodeTypes.includes(startNode.nodeType)) continue;

        // BFS queue: each entry is [currentNodeId, depth, pathSoFar]
        const queue: Array<{
          nodeId: string;
          depth: number;
          pathNodes: TraversalPath["nodes"];
          pathEdges: TraversalPath["edges"];
        }> = [
          {
            nodeId: startNodeId,
            depth: 0,
            pathNodes: [
              {
                id: startNode.id,
                nodeType: startNode.nodeType,
                entityId: startNode.entityId,
                label: startNode.label,
                riskScore: startNode.riskScore?.toNumber() ?? null,
              },
            ],
            pathEdges: [],
          },
        ];

        const visited = new Set<string>([startNodeId]);

        while (queue.length > 0) {
          const current = queue.shift()!;

          if (current.depth > maxDepth) continue;

          affectedNodes.add(current.nodeId);
          maxDepthFound = Math.max(maxDepthFound, current.depth);

          // If we've reached max depth, record the path and don't go deeper
          if (current.depth === maxDepth) {
            // Only record paths that have at least one edge (i.e., they actually traversed)
            if (current.pathEdges.length > 0) {
              paths.push({
                nodes: current.pathNodes,
                edges: current.pathEdges,
                totalDepth: current.depth,
                totalRisk: current.pathNodes.reduce(
                  (sum, n) => sum + (n.riskScore ?? 0),
                  0
                ),
              });
            }
            continue;
          }

          // Get neighboring edges
          const neighbors =
            direction === "incoming"
              ? incomingEdges.get(current.nodeId) ?? []
              : direction === "outgoing"
                ? outgoingEdges.get(current.nodeId) ?? []
                : [
                    ...(outgoingEdges.get(current.nodeId) ?? []),
                    ...(incomingEdges.get(current.nodeId) ?? []),
                  ];

          if (neighbors.length === 0) {
            // Dead end — record the path
            if (current.pathEdges.length > 0) {
              paths.push({
                nodes: current.pathNodes,
                edges: current.pathEdges,
                totalDepth: current.depth,
                totalRisk: current.pathNodes.reduce(
                  (sum, n) => sum + (n.riskScore ?? 0),
                  0
                ),
              });
            }
            continue;
          }

          let hasUnvisitedNeighbor = false;
          for (const edge of neighbors) {
            // Determine the neighbor node ID based on traversal direction
            const neighborId =
              direction === "incoming"
                ? edge.sourceNodeId
                : direction === "outgoing"
                  ? edge.targetNodeId
                  : edge.sourceNodeId === current.nodeId
                    ? edge.targetNodeId
                    : edge.sourceNodeId;

            if (visited.has(neighborId)) continue;

            // Filter by node types if specified
            const neighborNode = nodeMap.get(neighborId);
            if (!neighborNode) continue;
            if (query.nodeTypes && !query.nodeTypes.includes(neighborNode.nodeType)) continue;

            visited.add(neighborId);
            hasUnvisitedNeighbor = true;

            const newNodes: TraversalPath["nodes"] = [
              ...current.pathNodes,
              {
                id: neighborNode.id,
                nodeType: neighborNode.nodeType,
                entityId: neighborNode.entityId,
                label: neighborNode.label,
                riskScore: neighborNode.riskScore?.toNumber() ?? null,
              },
            ];

            const newEdges: TraversalPath["edges"] = [
              ...current.pathEdges,
              {
                id: edge.id,
                edgeType: edge.edgeType,
                strength: edge.strength?.toNumber() ?? null,
              },
            ];

            queue.push({
              nodeId: neighborId,
              depth: current.depth + 1,
              pathNodes: newNodes,
              pathEdges: newEdges,
            });
          }

          // If all neighbors were already visited, this is also a terminal path
          if (!hasUnvisitedNeighbor && current.pathEdges.length > 0) {
            paths.push({
              nodes: current.pathNodes,
              edges: current.pathEdges,
              totalDepth: current.depth,
              totalRisk: current.pathNodes.reduce(
                (sum, n) => sum + (n.riskScore ?? 0),
                0
              ),
            });
          }
        }
      }

      return {
        triggerId: "",
        paths,
        affectedNodes,
        maxDepth: maxDepthFound,
        totalNodes: allNodes.length,
        totalEdges: allEdges.length,
      };
    });
  } catch (error) {
    if (error instanceof CascadeTraversalError) throw error;
    const msg = error instanceof Error ? error.message : "Unknown traversal error";
    throw new CascadeTraversalError(msg, { tenantId, startNodeIds: query.startNodeIds });
  }
}

/**
 * Execute a cascade traversal for a specific trigger.
 * This is the main entry point for cascade analysis when a new regulation
 * or mandate change is detected.
 *
 * The traversal:
 * 1. Finds the CascadeGraph for the tenant
 * 2. Identifies start nodes from the trigger's affected ingredients
 * 3. Traverses the graph following appropriate edge types for the trigger type
 * 4. Counts affected SKUs (PRODUCT nodes reached)
 * 5. Updates the CascadeTrigger record with traversal results
 */
export async function traverseForTrigger(
  input: TriggerTraversalInput
): Promise<TriggerTraversalResult> {
  const { triggerId, ruleId, tenantId, triggerType, severity, affectedNodeIds } = input;

  logger.info(
    { triggerId, ruleId, tenantId, triggerType, severity, affectedNodeCount: affectedNodeIds.length },
    "Starting trigger-based cascade traversal"
  );

  try {
    return await withTenant(tenantId, async () => {
      const graph = await prisma.cascadeGraph.findFirst({
        where: { tenantId },
        orderBy: { version: "desc" },
      });

      if (!graph) {
        throw new CascadeTraversalError("No cascade graph found for tenant", { tenantId });
      }

      // Determine which edge types to follow based on trigger type
      const edgeTypes = getEdgeTypesForTrigger(triggerType);

      // Find the start nodes — these are the nodes directly affected by the trigger
      // For regulation triggers, start from REGULATION nodes
      // For supplier disruption, start from SUPPLIER nodes
      let startNodeIds: string[];

      if (affectedNodeIds.length > 0) {
        // Use the pre-identified affected nodes
        startNodeIds = affectedNodeIds;
      } else {
        // Find nodes related to the rule
        const ruleNodes = await prisma.cascadeNode.findMany({
          where: {
            graphId: graph.id,
            nodeType: "REGULATION",
            entityId: ruleId,
          },
          select: { id: true },
        });
        startNodeIds = ruleNodes.map((n) => n.id);
      }

      if (startNodeIds.length === 0) {
        logger.warn({ triggerId, ruleId }, "No start nodes found for trigger traversal");
      }

      // Execute the traversal
      const traversalResult = await traverseCascade(tenantId, {
        startNodeIds,
        edgeTypes,
        maxDepth: CASCADE_CONFIG.MAX_TRAVERSAL_DEPTH,
        minStrength: CASCADE_CONFIG.MIN_EDGE_STRENGTH,
        direction: triggerType === "SUPPLIER_DISRUPTION" ? "incoming" : "outgoing",
      });

      // Count affected SKUs (PRODUCT nodes in affected set)
      const affectedNodeRecords = await prisma.cascadeNode.findMany({
        where: {
          graphId: graph.id,
          id: { in: Array.from(traversalResult.affectedNodes) },
          nodeType: "PRODUCT",
        },
        include: {
          outEdges: { where: { edgeType: "SOLD_TO" } },
          inEdges: { where: { edgeType: "PRODUCED_FROM" } },
        },
      });

      const totalSkusAffected = affectedNodeRecords.length;

      // Calculate cascade breadth (number of distinct node types affected)
      const affectedNodeTypes = new Set(affectedNodeRecords.map((n) => n.nodeType));
      // Also count node types from all affected nodes
      const allAffectedRecords = await prisma.cascadeNode.findMany({
        where: {
          graphId: graph.id,
          id: { in: Array.from(traversalResult.affectedNodes) },
        },
        select: { nodeType: true },
      });
      const cascadeBreadth = new Set(allAffectedRecords.map((n) => n.nodeType)).size;

      // Update the trigger record with traversal results
      await prisma.cascadeTrigger.update({
        where: { id: triggerId },
        data: {
          affectedNodeIds: Array.from(traversalResult.affectedNodes),
          cascadeDepth: traversalResult.maxDepth,
          cascadeBreadth,
          totalSkusAffected,
          status: "ANALYZING",
        },
      });

      return {
        triggerId,
        traversalResult: {
          ...traversalResult,
          triggerId,
        },
        cascadeDepth: traversalResult.maxDepth,
        cascadeBreadth,
        totalSkusAffected,
        affectedNodeIds: Array.from(traversalResult.affectedNodes),
      };
    });
  } catch (error) {
    if (error instanceof CascadeTraversalError) throw error;
    const msg = error instanceof Error ? error.message : "Unknown trigger traversal error";
    logger.error({ triggerId, error: msg }, "Trigger traversal failed");
    throw new CascadeTraversalError(msg, { triggerId, ruleId });
  }
}

/**
 * Determine which edge types to follow based on the trigger type.
 * Not all triggers propagate through all relationships.
 */
function getEdgeTypesForTrigger(triggerType: TriggerType): CascadeEdgeType[] {
  switch (triggerType) {
    case "NEW_REGULATION":
    case "REGULATION_AMENDMENT":
      // Regulations affect products, which affect customers
      // Also need to trace back from regulation to ingredients
      return ["SUBJECT_TO", "CONTAINS", "PRODUCED_FROM", "SOLD_TO", "REQUIRES", "SUPERSEDES", "CONFLICTS_WITH"];
    case "REGULATION_REPEAL":
      // Repeals follow the same path but may reduce impact
      return ["SUBJECT_TO", "CONTAINS", "PRODUCED_FROM", "SOLD_TO"];
    case "RETAILER_MANDATE_CHANGE":
      // Retailer changes affect customer requirements
      return ["REQUIRES", "SOLD_TO", "PRODUCED_FROM", "CONTAINS"];
    case "SUPPLIER_DISRUPTION":
      // Supplier issues trace through supply chain
      return ["SUPPLIED_BY", "CONTAINS", "PRODUCED_FROM", "SOLD_TO"];
    case "INGREDIENT_SHORTAGE":
      // Ingredient shortages affect formulations and products
      return ["CONTAINS", "PRODUCED_FROM", "SOLD_TO"];
    default:
      // Follow all edges for unknown trigger types
      return ["CONTAINS", "PRODUCED_FROM", "SOLD_TO", "SUBJECT_TO", "REQUIRES", "SUPPLIED_BY", "SUPERSEDES", "CONFLICTS_WITH"];
  }
}

/**
 * Get all cascade triggers for a tenant with optional filtering.
 */
export async function getCascadeTriggers(tenantId: string, filters?: {
  status?: TriggerStatus;
  severity?: Severity;
  triggerType?: TriggerType;
}): Promise<Array<{
  id: string;
  title: string;
  description: string;
  triggerType: TriggerType;
  severity: Severity;
  status: TriggerStatus;
  cascadeDepth: number;
  cascadeBreadth: number;
  totalSkusAffected: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  deadlineDate: Date | null;
  createdAt: Date;
}>> {
  return withTenant(tenantId, async () => {
    const graphs = await prisma.cascadeGraph.findMany({
      where: { tenantId },
      select: { id: true },
    });

    if (graphs.length === 0) return [];

    const graphIds = graphs.map((g) => g.id);

    const triggers = await prisma.cascadeTrigger.findMany({
      where: {
        graphId: { in: graphIds },
        ...(filters?.status && { status: filters.status }),
        ...(filters?.severity && { severity: filters.severity }),
        ...(filters?.triggerType && { triggerType: filters.triggerType }),
      },
      orderBy: { createdAt: "desc" },
    });

    return triggers.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      triggerType: t.triggerType,
      severity: t.severity,
      status: t.status,
      cascadeDepth: t.cascadeDepth,
      cascadeBreadth: t.cascadeBreadth,
      totalSkusAffected: t.totalSkusAffected,
      estimatedCostMin: t.estimatedCostMin?.toNumber() ?? null,
      estimatedCostMax: t.estimatedCostMax?.toNumber() ?? null,
      deadlineDate: t.deadlineDate,
      createdAt: t.createdAt,
    }));
  });
}

/**
 * Get a single cascade trigger with full details.
 */
export async function getCascadeTrigger(
  tenantId: string,
  triggerId: string
): Promise<{
  id: string;
  graphId: string;
  ruleId: string;
  triggerType: TriggerType;
  severity: Severity;
  title: string;
  description: string;
  affectedNodeIds: string[];
  cascadeDepth: number;
  cascadeBreadth: number;
  totalSkusAffected: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  deadlineDate: Date | null;
  conflictDates: Record<string, unknown> | null;
  status: TriggerStatus;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  return withTenant(tenantId, async () => {
    const trigger = await prisma.cascadeTrigger.findUnique({
      where: { id: triggerId },
    });

    if (!trigger) return null;

    // Verify the trigger belongs to a graph owned by this tenant
    const graph = await prisma.cascadeGraph.findFirst({
      where: { id: trigger.graphId, tenantId },
    });

    if (!graph) return null;

    return {
      id: trigger.id,
      graphId: trigger.graphId,
      ruleId: trigger.ruleId,
      triggerType: trigger.triggerType,
      severity: trigger.severity,
      title: trigger.title,
      description: trigger.description,
      affectedNodeIds: trigger.affectedNodeIds,
      cascadeDepth: trigger.cascadeDepth,
      cascadeBreadth: trigger.cascadeBreadth,
      totalSkusAffected: trigger.totalSkusAffected,
      estimatedCostMin: trigger.estimatedCostMin?.toNumber() ?? null,
      estimatedCostMax: trigger.estimatedCostMax?.toNumber() ?? null,
      deadlineDate: trigger.deadlineDate,
      conflictDates: trigger.conflictDates as Record<string, unknown> | null,
      status: trigger.status,
      createdAt: trigger.createdAt,
      updatedAt: trigger.updatedAt,
    };
  });
}

/**
 * Create a cascade trigger when a new regulation or mandate change is detected.
 * This is called by the rule engine after SME validation.
 */
export async function createCascadeTrigger(input: {
  tenantId: string;
  ruleId: string;
  triggerType: TriggerType;
  severity: Severity;
  title: string;
  description: string;
  affectedNodeIds?: string[];
}): Promise<string> {
  const { tenantId, ruleId, triggerType, severity, title, description } = input;

  return withTenant(tenantId, async () => {
    const graph = await prisma.cascadeGraph.findFirst({
      where: { tenantId },
      orderBy: { version: "desc" },
    });

    if (!graph) {
      throw new CascadeTraversalError("No cascade graph found — build graph first", { tenantId });
    }

    // Find affected node IDs for this rule
    let affectedNodeIds = input.affectedNodeIds ?? [];
    if (affectedNodeIds.length === 0) {
      // Auto-detect: find all REGULATION nodes for this rule and their connected INGREDIENT nodes
      const regulationNodes = await prisma.cascadeNode.findMany({
        where: {
          graphId: graph.id,
          nodeType: "REGULATION",
          entityId: ruleId,
        },
        select: { id: true },
      });

      // Also find ingredient nodes linked to the rule via RuleSubstance matches
      const matchedIngredients = await prisma.ruleSubstance.findMany({
        where: {
          ruleId,
          isMatched: true,
          ingredient: { tenantId },
        },
        select: { ingredientId: true },
      });

      const ingredientNodeIds = await prisma.cascadeNode.findMany({
        where: {
          graphId: graph.id,
          nodeType: "INGREDIENT",
          entityId: { in: matchedIngredients.map((rs) => rs.ingredientId).filter((id): id is string => id !== null) },
        },
        select: { id: true },
      });

      affectedNodeIds = [
        ...regulationNodes.map((n) => n.id),
        ...ingredientNodeIds.map((n) => n.id),
      ];
    }

    // Calculate initial cascade metrics
    const cascadeDepth = 1; // Will be updated by traversal
    const cascadeBreadth = 1;
    const totalSkusAffected = 0;

    const trigger = await prisma.cascadeTrigger.create({
      data: {
        graphId: graph.id,
        ruleId,
        triggerType,
        severity,
        title,
        description,
        affectedNodeIds,
        cascadeDepth,
        cascadeBreadth,
        totalSkusAffected,
        status: "DETECTED",
      },
    });

    logger.info(
      {
        triggerId: trigger.id,
        tenantId,
        ruleId,
        triggerType,
        severity,
        affectedNodeCount: affectedNodeIds.length,
      },
      "Cascade trigger created"
    );

    return trigger.id;
  });
}
