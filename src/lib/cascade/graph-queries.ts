// Cascada — Apache AGE / Cypher Query Helpers
// Provides typed wrappers around Apache AGE Cypher queries executed
// inside PostgreSQL. These helpers construct safe, parameterized queries
// that leverage the graph extension for complex multi-hop traversals
// that would be inefficient with relational queries alone.
//
// Apache AGE integrates graph capabilities directly into PostgreSQL,
// allowing us to run Cypher queries alongside standard SQL without
// operating a separate graph database (like Neo4j).
//
// Graph name: cascada_graph (configured in db-init.sql)
// Vertex labels: Ingredient, Formulation, Product, Customer, Regulation,
//                Supplier, RetailerRequirement
// Edge labels: CONTAINS, PRODUCED_FROM, SOLD_TO, SUBJECT_TO,
//              REQUIRES, SUPPLIED_BY, SUPERSEDES, CONFLICTS_WITH

import { prisma, withTenant } from "@/lib/db";
import { createCascadeLogger } from "@/lib/logger";
import { CascadeGraphError } from "@/lib/errors";
import { CASCADE_CONFIG } from "@/lib/constants";
import type {
  CascadeNodeType,
  CascadeEdgeType,
} from "@prisma/client";
import type {
  CypherQueryResult,
  GraphTraversalQuery,
} from "@/types/cascade";

// ============================================================================
// Types
// ============================================================================

export interface CypherQueryOptions {
  graphName?: string;
  timeoutMs?: number;
}

export interface NeighborQueryResult {
  nodeId: string;
  nodeType: CascadeNodeType;
  entityId: string;
  label: string;
  edgeType: CascadeEdgeType;
  edgeStrength: number | null;
  depth: number;
}

export interface ShortestPathResult {
  path: Array<{
    nodeId: string;
    nodeType: CascadeNodeType;
    entityId: string;
    label: string;
  }>;
  totalEdges: number;
  totalStrength: number;
}

export interface SubgraphResult {
  nodes: Array<{
    id: string;
    nodeType: CascadeNodeType;
    entityId: string;
    label: string;
    properties: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: CascadeEdgeType;
    strength: number | null;
  }>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_GRAPH_NAME = "cascada_graph";
const DEFAULT_TIMEOUT_MS = 30000;

/** Mapping from CascadeNodeType to AGE vertex label */
const NODE_TYPE_TO_LABEL: Record<CascadeNodeType, string> = {
  INGREDIENT: "Ingredient",
  FORMULATION: "Formulation",
  PRODUCT: "Product",
  CUSTOMER: "Customer",
  REGULATION: "Regulation",
  RETAILER_REQUIREMENT: "RetailerRequirement",
  SUPPLIER: "Supplier",
};

/** Mapping from CascadeEdgeType to AGE edge label */
const EDGE_TYPE_TO_LABEL: Record<CascadeEdgeType, string> = {
  CONTAINS: "CONTAINS",
  PRODUCED_FROM: "PRODUCED_FROM",
  SOLD_TO: "SOLD_TO",
  SUBJECT_TO: "SUBJECT_TO",
  REQUIRES: "REQUIRES",
  SUPPLIED_BY: "SUPPLIED_BY",
  SUPERSEDES: "SUPERSEDES",
  CONFLICTS_WITH: "CONFLICTS_WITH",
};

const logger = createCascadeLogger("graph-queries");

// ============================================================================
// Raw Cypher Execution
// ============================================================================

/**
 * Execute a raw Cypher query against the Apache AGE graph.
 *
 * This is the low-level execution function. All other query helpers
 * use this function internally. It wraps the query in PostgreSQL's
 * AGE extension syntax: SELECT * FROM cypher('graph_name', $$ query $$) as result;
 *
 * IMPORTANT: This function uses parameterized queries where possible,
 * but Cypher queries inside AGE are passed as strings. Never concatenate
 * user input directly into Cypher queries — use the helper functions
 * that properly escape parameters.
 */
export async function executeCypherQuery(
  tenantId: string,
  cypherQuery: string,
  options: CypherQueryOptions = {}
): Promise<CypherQueryResult> {
  const {
    graphName = DEFAULT_GRAPH_NAME,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const startTime = Date.now();

  logger.debug({ tenantId, graphName, queryLength: cypherQuery.length }, "Executing Cypher query");

  try {
    return await withTenant(tenantId, async () => {
      // Set query timeout
      await prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '${timeoutMs}ms';`);

      // Execute the Cypher query via AGE
      const query = `SELECT * FROM cypher('${graphName}', $$ ${cypherQuery} $$) AS (result agtype);`;

      const rawResults = await prisma.$queryRawUnsafe(query);

      const executionTimeMs = Date.now() - startTime;

      // Parse AGE results (agtype format)
      const rows = (rawResults as Array<{ result: string }>).map((row) => {
        try {
          return parseAgtype(row.result);
        } catch {
          logger.warn({ rawResult: row.result }, "Failed to parse agtype result");
          return {};
        }
      });

      const columns = rows.length > 0 ? Object.keys(rows[0] ?? {}) : [];

      return {
        rows,
        columns,
        rowCount: rows.length,
        executionTimeMs,
      };
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown Cypher query error";
    logger.error({ tenantId, graphName, error: msg }, "Cypher query failed");
    throw new CascadeGraphError(`Cypher query failed: ${msg}`, { tenantId, graphName });
  }
}

// ============================================================================
// High-Level Query Helpers
// ============================================================================

/**
 * Find all neighbors of a node within a specified depth.
 * Uses BFS traversal via Cypher for efficient graph walking.
 */
export async function findNeighbors(
  tenantId: string,
  startEntityId: string,
  startNodeType: CascadeNodeType,
  maxDepth: number = CASCADE_CONFIG.MAX_TRAVERSAL_DEPTH,
  edgeTypes?: CascadeEdgeType[]
): Promise<NeighborQueryResult[]> {
  const label = NODE_TYPE_TO_LABEL[startNodeType];
  const edgeFilter = edgeTypes
    ? `:${edgeTypes.map((et) => EDGE_TYPE_TO_LABEL[et]).join("|")}`
    : "";

  const query = `
    MATCH (start:${label} {entityId: '${sanitizeCypher(startEntityId)}'})-[r${edgeFilter}*1..${maxDepth}]-(neighbor)
    RETURN DISTINCT
      neighbor.entityId AS entityId,
      labels(neighbor)[0] AS nodeType,
      neighbor.label AS label,
      type(last(r)) AS edgeType,
      last(r).strength AS edgeStrength,
      length(r) AS depth
    ORDER BY depth ASC, edgeStrength DESC
  `;

  const result = await executeCypherQuery(tenantId, query);

  return result.rows.map((row) => ({
    nodeId: String(row["entityId"] ?? ""),
    nodeType: labelToNodeType(String(row["nodeType"] ?? "")),
    entityId: String(row["entityId"] ?? ""),
    label: String(row["label"] ?? ""),
    edgeType: labelToEdgeType(String(row["edgeType"] ?? "")),
    edgeStrength: row["edgeStrength"] != null ? Number(row["edgeStrength"]) : null,
    depth: Number(row["depth"] ?? 0),
  }));
}

/**
 * Find the shortest path between two nodes.
 * Uses Cypher's shortestPath() function for optimal route finding.
 */
export async function findShortestPath(
  tenantId: string,
  fromEntityId: string,
  fromNodeType: CascadeNodeType,
  toEntityId: string,
  toNodeType: CascadeNodeType
): Promise<ShortestPathResult | null> {
  const fromLabel = NODE_TYPE_TO_LABEL[fromNodeType];
  const toLabel = NODE_TYPE_TO_LABEL[toNodeType];

  const query = `
    MATCH (from:${fromLabel} {entityId: '${sanitizeCypher(fromEntityId)}'}),
          (to:${toLabel} {entityId: '${sanitizeCypher(toEntityId)}'})
    MATCH path = shortestPath((from)-[*]-(to))
    RETURN
      [node IN nodes(path) | {
        entityId: node.entityId,
        nodeType: labels(node)[0],
        label: node.label
      }] AS pathNodes,
      length(path) AS totalEdges,
      reduce(s = 0, r IN relationships(path) | s + COALESCE(r.strength, 0.5)) AS totalStrength
  `;

  const result = await executeCypherQuery(tenantId, query);

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  if (!row) return null;
  const pathNodes = (row["pathNodes"] ?? []) as Array<Record<string, unknown>>;

  return {
    path: pathNodes.map((node) => ({
      nodeId: String(node["entityId"] ?? ""),
      nodeType: labelToNodeType(String(node["nodeType"] ?? "")),
      entityId: String(node["entityId"] ?? ""),
      label: String(node["label"] ?? ""),
    })),
    totalEdges: Number(row["totalEdges"] ?? 0),
    totalStrength: Number(row["totalStrength"] ?? 0),
  };
}

/**
 * Extract a subgraph around a set of start nodes.
 * Useful for visualization and focused analysis.
 */
export async function extractSubgraph(
  tenantId: string,
  startEntityIds: string[],
  startNodeType: CascadeNodeType,
  depth: number = 2
): Promise<SubgraphResult> {
  const label = NODE_TYPE_TO_LABEL[startNodeType];
  const idList = startEntityIds.map((id) => `'${sanitizeCypher(id)}'`).join(", ");

  const query = `
    MATCH (start:${label})
    WHERE start.entityId IN [${idList}]
    CALL {
      WITH start
      MATCH path = (start)-[*1..${depth}]-(neighbor)
      RETURN path
    }
    WITH collect(DISTINCT path) AS paths
    UNWIND paths AS p
    WITH collect(DISTINCT {
      id: elementId(startNode(p)),
      entityType: labels(startNode(p))[0],
      entityId: startNode(p).entityId,
      label: startNode(p).label,
      properties: properties(startNode(p))
    }) AS startNodes,
    collect(DISTINCT {
      id: elementId(endNode(p)),
      entityType: labels(endNode(p))[0],
      entityId: endNode(p).entityId,
      label: endNode(p).label,
      properties: properties(endNode(p))
    }) AS endNodes,
    collect(DISTINCT {
      id: elementId(relationships(p)[0]),
      sourceId: elementId(startNode(p)),
      targetId: elementId(endNode(p)),
      edgeType: type(relationships(p)[0]),
      strength: relationships(p)[0].strength
    }) AS edges
    RETURN startNodes, endNodes, edges
  `;

  const result = await executeCypherQuery(tenantId, query);

  if (result.rows.length === 0) {
    return { nodes: [], edges: [] };
  }

  const row = result.rows[0];
  if (!row) return { nodes: [], edges: [] };
  const startNodes = (row["startNodes"] ?? []) as Array<Record<string, unknown>>;
  const endNodes = (row["endNodes"] ?? []) as Array<Record<string, unknown>>;
  const rawEdges = (row["edges"] ?? []) as Array<Record<string, unknown>>;

  // Merge start and end nodes (deduplicate by entityId)
  const nodeMap = new Map<string, SubgraphResult["nodes"][0]>();
  for (const node of [...startNodes, ...endNodes]) {
    const entityId = String(node["entityId"] ?? "");
    if (!nodeMap.has(entityId)) {
      nodeMap.set(entityId, {
        id: String(node["id"] ?? ""),
        nodeType: labelToNodeType(String(node["entityType"] ?? "")),
        entityId,
        label: String(node["label"] ?? ""),
        properties: (node["properties"] ?? {}) as Record<string, unknown>,
      });
    }
  }

  const edges: SubgraphResult["edges"] = rawEdges.map((edge) => ({
    id: String(edge["id"] ?? ""),
    sourceNodeId: String(edge["sourceId"] ?? ""),
    targetNodeId: String(edge["targetId"] ?? ""),
    edgeType: labelToEdgeType(String(edge["edgeType"] ?? "")),
    strength: edge["strength"] != null ? Number(edge["strength"]) : null,
  }));

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
  };
}

/**
 * Count nodes and edges by type for a tenant's graph.
 * Uses Cypher aggregation for efficient counting.
 */
export async function countGraphElements(
  tenantId: string
): Promise<{
  nodeCounts: Record<CascadeNodeType, number>;
  edgeCounts: Record<CascadeEdgeType, number>;
  totalNodes: number;
  totalEdges: number;
}> {
  const nodeQuery = `
    MATCH (n)
    RETURN labels(n)[0] AS nodeType, count(n) AS count
    ORDER BY count DESC
  `;

  const edgeQuery = `
    MATCH ()-[r]->()
    RETURN type(r) AS edgeType, count(r) AS count
    ORDER BY count DESC
  `;

  const [nodeResult, edgeResult] = await Promise.all([
    executeCypherQuery(tenantId, nodeQuery),
    executeCypherQuery(tenantId, edgeQuery),
  ]);

  const nodeCounts = {} as Record<CascadeNodeType, number>;
  for (const row of nodeResult.rows) {
    const nodeType = labelToNodeType(String(row["nodeType"] ?? ""));
    if (nodeType) {
      nodeCounts[nodeType] = Number(row["count"] ?? 0);
    }
  }

  const edgeCounts = {} as Record<CascadeEdgeType, number>;
  for (const row of edgeResult.rows) {
    const edgeType = labelToEdgeType(String(row["edgeType"] ?? ""));
    if (edgeType) {
      edgeCounts[edgeType] = Number(row["count"] ?? 0);
    }
  }

  const totalNodes = Object.values(nodeCounts).reduce((a, b) => a + b, 0);
  const totalEdges = Object.values(edgeCounts).reduce((a, b) => a + b, 0);

  return { nodeCounts, edgeCounts, totalNodes, totalEdges };
}

/**
 * Find all paths from a regulation node to affected products.
 * This is the core query for cascade impact analysis.
 */
export async function findRegulationImpactPaths(
  tenantId: string,
  ruleId: string,
  maxDepth: number = CASCADE_CONFIG.MAX_TRAVERSAL_DEPTH
): Promise<Array<{
  path: Array<{
    entityId: string;
    nodeType: CascadeNodeType;
    label: string;
  }>;
  totalDepth: number;
  productSku: string | null;
}>> {
  const query = `
    MATCH (reg:Regulation {entityId: '${sanitizeCypher(ruleId)}'})-[*1..${maxDepth}]-(product:Product)
    MATCH path = shortestPath((reg)-[*]-(product))
    RETURN
      [node IN nodes(path) | {
        entityId: node.entityId,
        nodeType: labels(node)[0],
        label: node.label
      }] AS pathNodes,
      length(path) AS totalDepth,
      product.sku AS productSku
    ORDER BY totalDepth ASC
  `;

  const result = await executeCypherQuery(tenantId, query);

  return result.rows.map((row) => ({
    path: ((row["pathNodes"] ?? []) as Array<Record<string, unknown>>).map((node) => ({
      entityId: String(node["entityId"] ?? ""),
      nodeType: labelToNodeType(String(node["nodeType"] ?? "")),
      label: String(node["label"] ?? ""),
    })),
    totalDepth: Number(row["totalDepth"] ?? 0),
    productSku: row["productSku"] != null ? String(row["productSku"]) : null,
  }));
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sanitize a string for safe inclusion in a Cypher query.
 * Prevents Cypher injection by escaping special characters.
 */
function sanitizeCypher(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$");
}

/**
 * Parse an Apache AGE agtype string into a JavaScript object.
 * agtype is similar to JSON but has some differences.
 */
function parseAgtype(agtypeStr: string): Record<string, unknown> {
  // agtype looks like: {"key": "value", "num": 123}::vertex
  // or: {"key": "value"}::edge
  // Strip the type suffix
  const cleanStr = agtypeStr.replace(/::(vertex|edge|path|map|list)$/, "");

  try {
    return JSON.parse(cleanStr) as Record<string, unknown>;
  } catch {
    // If JSON parsing fails, return the raw string as a value
    return { raw: cleanStr };
  }
}

/**
 * Convert an AGE vertex label back to CascadeNodeType.
 */
function labelToNodeType(label: string): CascadeNodeType {
  const reverseMap: Record<string, CascadeNodeType> = {
    Ingredient: "INGREDIENT",
    Formulation: "FORMULATION",
    Product: "PRODUCT",
    Customer: "CUSTOMER",
    Regulation: "REGULATION",
    RetailerRequirement: "RETAILER_REQUIREMENT",
    Supplier: "SUPPLIER",
  };
  return reverseMap[label] ?? "INGREDIENT";
}

/**
 * Convert an AGE edge label back to CascadeEdgeType.
 */
function labelToEdgeType(label: string): CascadeEdgeType {
  const reverseMap: Record<string, CascadeEdgeType> = {
    CONTAINS: "CONTAINS",
    PRODUCED_FROM: "PRODUCED_FROM",
    SOLD_TO: "SOLD_TO",
    SUBJECT_TO: "SUBJECT_TO",
    REQUIRES: "REQUIRES",
    SUPPLIED_BY: "SUPPLIED_BY",
    SUPERSEDES: "SUPERSEDES",
    CONFLICTS_WITH: "CONFLICTS_WITH",
  };
  return reverseMap[label] ?? "CONTAINS";
}
