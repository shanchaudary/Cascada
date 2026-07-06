// Cascada — Cascade Engine Type Definitions
// Types for the cascade graph, traversal, impact scoring, and cost modeling.

import type {
  CascadeNodeType,
  CascadeEdgeType,
  Severity,
  TriggerType,
  ImpactType,
  TriggerStatus,
} from "@prisma/client";

// ============================================================================
// Graph node types
// ============================================================================
export interface CascadeNodeProperties {
  // Ingredient properties
  casNumber?: string;
  eenumber?: string;
  category?: string;
  isSynthetic?: boolean;
  sourceType?: string;
  allergenFlags?: string[];

  // Product properties
  sku?: string;
  brand?: string;
  markets?: string[];
  retailers?: string[];
  annualRevenue?: number;
  annualVolume?: number;

  // Customer properties
  customerType?: string;
  requirements?: Record<string, unknown>;

  // Regulation properties
  ruleType?: string;
  jurisdiction?: string;
  effectiveDate?: string;
  complianceDate?: string;

  // Supplier properties
  certifications?: string[];
  riskScore?: number;
}

export interface CascadeEdgeProperties {
  // CONTAINS edge: concentration info
  concentration?: number;
  concentrationUnit?: string;
  percentage?: number;

  // SOLD_TO edge: contract terms
  contractExpiry?: string;
  volumeCommitment?: number;

  // SUBJECT_TO edge: regulation applicability
  threshold?: number;
  thresholdUnit?: string;

  // SUPPLIED_BY edge: supply terms
  leadTimeDays?: number;
  minimumOrderQuantity?: number;
  costPerUnit?: number;
}

// ============================================================================
// Traversal types
// ============================================================================
export interface TraversalPath {
  nodes: Array<{
    id: string;
    nodeType: CascadeNodeType;
    entityId: string;
    label: string;
    riskScore: number | null;
  }>;
  edges: Array<{
    id: string;
    edgeType: CascadeEdgeType;
    strength: number | null;
  }>;
  totalDepth: number;
  totalRisk: number;
}

export interface TraversalResult {
  triggerId: string;
  paths: TraversalPath[];
  affectedNodes: Set<string>;
  maxDepth: number;
  totalNodes: number;
  totalEdges: number;
}

// ============================================================================
// Impact scoring types
// ============================================================================
export interface ImpactScore {
  nodeId: string;
  nodeType: CascadeNodeType;
  entityId: string;
  label: string;
  impactType: ImpactType;
  financialImpact: number;
  timelineImpactDays: number;
  severity: Severity;
  probability: number; // 0-1
  reformRequired: boolean;
  reformCost: number | null;
  overallRiskScore: number; // 0-1, weighted composite
}

export interface CompositeImpactScore {
  triggerId: string;
  totalFinancialImpact: number;
  totalSkusAffected: number;
  totalRevenueAtRisk: number;
  maxDepth: number;
  maxSeverity: Severity;
  impactByType: Record<ImpactType, number>;
  impactByNodeType: Record<CascadeNodeType, number>;
  overallRiskScore: number;
}

// ============================================================================
// Cost modeling types
// ============================================================================
export interface ReformulationCostEstimate {
  ingredientId: string;
  ingredientName: string;
  substituteOptions: Array<{
    substituteId: string;
    substituteName: string;
    costDelta: number; // Per unit cost change
    feasibilityScore: number; // 0-1
    sensoryImpact: string;
    shelfLifeImpact: string;
    regulatoryRisk: string;
    estimatedTimelineDays: number;
    totalCost: number; // Including R&D, testing, regulatory filing
  }>;
  bestOption: {
    substituteId: string;
    substituteName: string;
    totalCost: number;
    timelineDays: number;
    riskLevel: string;
  } | null;
}

export interface LabelChangeCostEstimate {
  productId: string;
  productName: string;
  sku: string;
  changeType: "add_warning" | "remove_claim" | "update_ingredients" | "new_disclosure";
  estimatedCost: number;
  timelineDays: number;
  affectedMarkets: string[];
  printRunSize: number | null;
}

export interface CascadeCostSummary {
  reformulationCosts: ReformulationCostEstimate[];
  labelChangeCosts: LabelChangeCostEstimate[];
  totalCostMin: number;
  totalCostMax: number;
  timelineDays: number;
  revenueAtRisk: number;
}

// ============================================================================
// Timeline types
// ============================================================================
export interface ComplianceTimeline {
  triggerId: string;
  events: TimelineEvent[];
  conflicts: TimelineConflict[];
  criticalPath: string[]; // Node IDs on the critical path
}

export interface TimelineEvent {
  date: string;
  type: "regulation_effective" | "compliance_deadline" | "grace_period_end" | "review_deadline" | "contract_expiry";
  description: string;
  jurisdiction: string;
  severity: Severity;
  affectedNodeIds: string[];
}

export interface TimelineConflict {
  id: string;
  description: string;
  conflictingEvents: Array<{
    eventId: string;
    date: string;
    jurisdiction: string;
  }>;
  resolutionOptions: Array<{
    description: string;
    costImpact: number;
    timelineImpactDays: number;
  }>;
}

// ============================================================================
// Prioritization types
// ============================================================================
export interface PrioritizedTrigger {
  triggerId: string;
  title: string;
  severity: Severity;
  triggerType: TriggerType;
  status: TriggerStatus;
  totalSkusAffected: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  deadlineDate: string | null;
  daysUntilDeadline: number | null;
  riskScore: number; // 0-1
  impactScore: number; // 0-1
  urgencyScore: number; // 0-1
  compositeScore: number; // riskScore * 0.4 + impactScore * 0.3 + urgencyScore * 0.3
  rank: number;
}

// ============================================================================
// Graph query types (AGE/Cypher)
// ============================================================================
export interface CypherQueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  executionTimeMs: number;
}

export interface GraphTraversalQuery {
  startNodeIds: string[];
  edgeTypes?: CascadeEdgeType[];
  maxDepth: number;
  minStrength?: number;
  direction: "outgoing" | "incoming" | "both";
  nodeTypes?: CascadeNodeType[];
}
