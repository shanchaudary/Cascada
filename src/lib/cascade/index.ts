// Cascada — Cascade Module Barrel Exports
// All cascade engine functionality is accessed through this module.

// Graph builder
export {
  buildCascadeGraph,
  getGraphStats,
  getCascadeGraph,
  type GraphBuildResult,
  type GraphBuildOptions,
} from "./builder";

// Traverser
export {
  traverseCascade,
  traverseForTrigger,
  getCascadeTriggers,
  getCascadeTrigger,
  createCascadeTrigger,
  type TraverseOptions,
  type TriggerTraversalInput,
  type TriggerTraversalResult,
} from "./traverser";

// Impact scorer
export {
  scoreCascadeImpact,
  getTriggerImpacts,
  type ImpactScoringInput,
  type ImpactScoringResult,
} from "./impact-scorer";

// Cost model
export {
  estimateCascadeCosts,
  type CostEstimationInput,
  type SubstitutionCostDetail,
} from "./cost-model";

// Timeline
export {
  buildComplianceTimeline,
  getUrgentDeadlines,
  type TimelineBuildInput,
  type ConflictDetectionResult,
} from "./timeline";

// Prioritizer
export {
  prioritizeTriggers,
  getExposureByJurisdiction,
  getExposureByProduct,
  type PrioritizationInput,
  type PrioritizationResult,
} from "./prioritizer";

// Graph queries (AGE/Cypher)
export {
  executeCypherQuery,
  findNeighbors,
  findShortestPath,
  extractSubgraph,
  countGraphElements,
  findRegulationImpactPaths,
  type CypherQueryOptions,
  type NeighborQueryResult,
  type ShortestPathResult,
  type SubgraphResult,
} from "./graph-queries";
