// Cascada — AI Agent Types
// Shared types for the three AI agents: Executive Query, Reformulation Advisor,
// Workflow Generator. All agent state, conversation models, tool definitions,
// and result types are defined here.

import { z } from "zod";

// ============================================================================
// Agent Identity
// ============================================================================

export type AgentType = "executive_query" | "reformulation" | "workflow_generator";

export const AGENT_IDENTITIES: Record<AgentType, { name: string; description: string; version: string }> = {
  executive_query: {
    name: "Cascada Executive Advisor",
    description: "Answers C-suite questions about regulatory exposure, compliance timelines, and financial impact using RAG from the tenant's cascade graph.",
    version: "1.0.0",
  },
  reformulation: {
    name: "Cascada Reformulation Advisor",
    description: "Suggests reformulation alternatives for ingredients that are banned, restricted, or under regulatory pressure, with feasibility and cost analysis.",
    version: "1.0.0",
  },
  workflow_generator: {
    name: "Cascada Workflow Generator",
    description: "Generates Temporal workflow definitions from decision packages, translating executive decisions into orchestrated compliance actions.",
    version: "1.0.0",
  },
};

// ============================================================================
// Conversation & Message Types
// ============================================================================

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string; // ISO 8601
  /** Token usage for this message (only for assistant messages) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Tool call ID if this is a tool result message */
  toolCallId?: string;
  /** Tool calls made in this assistant message */
  toolCalls?: AgentToolCall[];
  /** Metadata for audit/logging */
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  tenantId: string;
  userId: string;
  agentType: AgentType;
  title: string;
  messages: AgentMessage[];
  status: ConversationStatus;
  /** Context snapshot used for this conversation */
  contextSnapshot?: RAGContext;
  /** Summary of the conversation (generated on close) */
  summary?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export type ConversationStatus = "active" | "closed" | "expired";

// ============================================================================
// RAG Context Types
// ============================================================================

export interface RAGContext {
  /** Regulations relevant to the query */
  regulations: RegulationContextItem[];
  /** Products affected by relevant regulations */
  products: ProductContextItem[];
  /** Cascade impacts computed for the tenant */
  impacts: ImpactContextItem[];
  /** Compliance timelines with deadlines */
  timelines: TimelineContextItem[];
  /** Ingredient details for reformulation queries */
  ingredients?: IngredientContextItem[];
  /** Decision packages for workflow generation */
  decisionPackages?: DecisionPackageContextItem[];
  /** Metadata about the context retrieval */
  retrievalMeta: {
    totalRegulations: number;
    totalProducts: number;
    totalImpacts: number;
    retrievalTimeMs: number;
    contextTokensEstimate: number;
  };
}

export interface RegulationContextItem {
  id: string;
  name: string;
  jurisdiction: string;
  status: string;
  sourceType: string;
  effectiveDate: string | null;
  complianceDate: string | null;
  description: string;
  ruleType: string;
  substances: Array<{
    substanceName: string;
    substanceType: string;
    casNumber: string | null;
    eenumber: string | null;
    threshold: number | null;
    thresholdUnit: string | null;
  }>;
}

export interface ProductContextItem {
  id: string;
  name: string;
  sku: string;
  category: string | null;
  brand: string | null;
  markets: string[];
  retailers: string[];
  annualRevenue: number | null;
  annualVolume: number | null;
  /** Formulation details */
  formulation?: {
    id: string;
    name: string;
    ingredients: Array<{
      name: string;
      casNumber: string | null;
      eenumber: string | null;
      percentage: number | null;
    }>;
  };
}

export interface ImpactContextItem {
  id: string;
  triggerId: string;
  triggerTitle: string;
  triggerSeverity: string;
  impactType: string;
  description: string;
  financialImpact: number | null;
  timelineDays: number | null;
  reformRequired: boolean;
  reformCost: number | null;
  priority: number | null;
}

export interface TimelineContextItem {
  regulationName: string;
  jurisdiction: string;
  deadline: string;
  daysRemaining: number;
  gracePeriodDays: number | null;
  conflictWith: string | null;
  severity: string;
  affectedSkuCount: number;
}

export interface IngredientContextItem {
  id: string;
  name: string;
  casNumber: string | null;
  eenumber: string | null;
  category: string | null;
  isSynthetic: boolean | null;
  sourceType: string | null;
  allergenFlags: string[];
  /** Substitution options already in the system */
  substitutionOptions: Array<{
    substituteName: string;
    feasibilityScore: number | null;
    sensoryImpact: string | null;
    costDelta: number | null;
    source: string | null;
  }>;
  /** Which products use this ingredient */
  usedInProducts: Array<{
    name: string;
    sku: string;
    concentrationPercentage: number | null;
  }>;
}

export interface DecisionPackageContextItem {
  id: string;
  title: string;
  summary: string;
  triggerId: string;
  status: string;
  affectedSkuCount: number;
  estimatedCostMin: number | null;
  estimatedCostMax: number | null;
  deadline: string | null;
  recommendation: string;
  decision: string | null;
}

// ============================================================================
// Tool Definitions (Function Calling)
// ============================================================================

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string; // JSON-encoded
}

export type ToolName =
  | "search_regulations"
  | "search_products"
  | "get_cascade_impacts"
  | "get_compliance_timelines"
  | "get_ingredient_details"
  | "get_reformulation_options"
  | "get_decision_package"
  | "generate_decision_package"
  | "estimate_reformulation_cost"
  | "generate_workflow";

export interface AgentToolDefinition {
  name: ToolName;
  description: string;
  parameters: z.ZodType;
  /** Which agents can use this tool */
  availableTo: AgentType[];
  /** Does this tool modify data (vs read-only)? */
  isMutating: boolean;
  /** Plan required to use this tool */
  requiredPlan?: "SCOUT" | "PRO" | "COMMAND";
}

// ============================================================================
// Agent Execution Types
// ============================================================================

export interface AgentExecutionContext {
  tenantId: string;
  userId: string;
  agentType: AgentType;
  conversationId: string;
  /** The user's plan, for feature gating */
  plan: "DIAGNOSTIC" | "SCOUT" | "PRO" | "COMMAND";
  /** Maximum tokens for the response */
  maxTokens?: number;
  /** Whether to include tool calls in the response */
  enableTools: boolean;
  /** Request trace ID for logging */
  traceId: string;
}

export interface AgentExecutionResult {
  /** The assistant's response text */
  content: string;
  /** Tool calls made during execution */
  toolCalls: AgentToolCall[];
  /** Updated conversation messages */
  messages: AgentMessage[];
  /** Token usage for this execution */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  /** The model used */
  model: string;
  /** Whether fallback was used */
  usedFallback: boolean;
  /** Execution latency */
  latencyMs: number;
  /** RAG context used */
  contextUsed: RAGContext;
  /** Trace ID */
  traceId: string;
}

// ============================================================================
// Executive Query Agent Specific Types
// ============================================================================

export interface ExecutiveQueryInput {
  query: string;
  conversationId?: string;
  /** Additional context provided by the user */
  contextOverride?: {
    focusJurisdictions?: string[];
    focusProducts?: string[];
    focusRegulations?: string[];
    timeHorizonDays?: number;
  };
}

export interface ExecutiveQueryResult extends AgentExecutionResult {
  /** Extracted intent from the query */
  detectedIntent: QueryIntent;
  /** Key topics identified */
  topics: string[];
  /** Suggested follow-up questions */
  followUpQuestions: string[];
}

export type QueryIntent =
  | "regulation_status"
  | "product_exposure"
  | "compliance_timeline"
  | "financial_impact"
  | "reformulation_options"
  | "supplier_risk"
  | "customer_impact"
  | "general_inquiry";

// ============================================================================
// Reformulation Advisor Specific Types
// ============================================================================

export interface ReformulationInput {
  /** The ingredient to find substitutes for */
  ingredientId: string;
  /** Optional specific trigger to consider */
  triggerId?: string;
  /** Product IDs to focus on (if not all affected products) */
  focusProductIds?: string[];
  /** Whether to include AI-suggested substitutes beyond existing catalog */
  includeAiSuggestions: boolean;
}

export interface ReformulationResult extends AgentExecutionResult {
  /** Suggested substitutes */
  substitutes: ReformulationSubstitute[];
  /** Overall recommendation */
  recommendation: {
    bestSubstitute: string | null;
    reasoning: string;
    estimatedTotalCost: number | null;
    estimatedTimelineDays: number | null;
  };
}

export interface ReformulationSubstitute {
  ingredientName: string;
  casNumber: string | null;
  eenumber: string | null;
  category: string | null;
  feasibilityScore: number; // 0-1
  sensoryImpact: "none" | "minor" | "moderate" | "significant";
  shelfLifeImpact: string;
  regulatoryRisk: "none" | "review_needed" | "restricted_in_some_jurisdictions";
  costDeltaPerUnit: number | null;
  implementationTimelineDays: number | null;
  source: "ai_suggestion" | "existing_catalog" | "supplier_recommended";
  reasoning: string;
  /** Which products this substitute would work for */
  applicableProducts: string[];
  /** Any allergen flags on the substitute */
  allergenFlags: string[];
}

// ============================================================================
// Workflow Generator Specific Types
// ============================================================================

export interface WorkflowGeneratorInput {
  /** The decision package to generate a workflow for */
  decisionPackageId: string;
  /** The executive decision */
  decision: "accept" | "reject" | "defer" | "partial";
  /** Decision notes from the executive */
  decisionNotes?: string;
  /** Custom modifications requested */
  modifications?: {
    skipSteps?: string[];
    addSteps?: Array<{ name: string; description: string; assignee?: string }>;
    changeTimeline?: { deadline: string };
  };
}

export interface WorkflowGeneratorResult extends AgentExecutionResult {
  /** Generated workflow definition */
  workflow: GeneratedWorkflow;
  /** Validation result */
  validation: {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  };
}

export interface GeneratedWorkflow {
  name: string;
  type: WorkflowType;
  description: string;
  estimatedDurationDays: number;
  steps: GeneratedWorkflowStep[];
  /** Total estimated cost of executing this workflow */
  estimatedCost: number | null;
  /** Risk factors identified */
  riskFactors: string[];
  /** Key milestones */
  milestones: Array<{
    name: string;
    targetDate: string;
    dependsOn: string[];
  }>;
}

export type WorkflowType =
  | "reformulation"
  | "label_change"
  | "product_withdrawal"
  | "compliance_review"
  | "supplier_transition"
  | "mixed";

export interface GeneratedWorkflowStep {
  id: string;
  name: string;
  description: string;
  type: WorkflowStepType;
  /** Role responsible for this step */
  assignedRole: string;
  /** Estimated duration in days */
  estimatedDurationDays: number;
  /** Dependencies (step IDs that must complete first) */
  dependsOn: string[];
  /** Whether this step requires approval */
  requiresApproval: boolean;
  /** Parameters for this step */
  parameters: Record<string, unknown>;
  /** Is this step on the critical path? */
  isCriticalPath: boolean;
}

export type WorkflowStepType =
  | "notification"
  | "task_creation"
  | "erp_update"
  | "approval"
  | "review"
  | "testing"
  | "regulatory_filing"
  | "supplier_negotiation"
  | "production_change"
  | "label_update"
  | "quality_check"
  | "stakeholder_communication";

// ============================================================================
// Agent Configuration
// ============================================================================

export const AGENT_CONFIG = {
  /** Maximum conversation history messages to include in context */
  MAX_HISTORY_MESSAGES: 20,
  /** Maximum tokens for agent system + context + history */
  MAX_CONTEXT_TOKENS: 8000,
  /** Maximum tokens for agent response */
  MAX_RESPONSE_TOKENS: 2000,
  /** Maximum tool calls per agent turn */
  MAX_TOOL_CALLS_PER_TURN: 5,
  /** Conversation expiry in days */
  CONVERSATION_EXPIRY_DAYS: 30,
  /** Maximum concurrent conversations per tenant per agent */
  MAX_CONCURRENT_CONVERSATIONS: 10,
  /** Agent rate limits (requests per minute per tenant) */
  RATE_LIMITS: {
    executive_query: 20,
    reformulation: 10,
    workflow_generator: 5,
  },
  /** Token budgets per plan */
  TOKEN_BUDGETS: {
    DIAGNOSTIC: { daily: 0, monthly: 0 },        // No agent access
    SCOUT: { daily: 0, monthly: 0 },              // No agent access
    PRO: { daily: 50000, monthly: 1000000 },      // Query agent + reformulation
    COMMAND: { daily: 200000, monthly: 5000000 },  // All agents
  },
  /** Which agents are available per plan */
  AGENT_PLAN_ACCESS: {
    DIAGNOSTIC: [] as AgentType[],
    SCOUT: [] as AgentType[],
    PRO: ["executive_query", "reformulation"] as AgentType[],
    COMMAND: ["executive_query", "reformulation", "workflow_generator"] as AgentType[],
  },
} as const;

// ============================================================================
// Zod Schemas for Agent Input Validation
// ============================================================================

export const ExecutiveQueryInputSchema = z.object({
  query: z.string().min(3, "Query must be at least 3 characters").max(2000, "Query too long"),
  conversationId: z.string().optional(),
  contextOverride: z.object({
    focusJurisdictions: z.array(z.string()).optional(),
    focusProducts: z.array(z.string()).optional(),
    focusRegulations: z.array(z.string()).optional(),
    timeHorizonDays: z.number().int().min(1).max(3650).optional(),
  }).optional(),
});

export const ReformulationInputSchema = z.object({
  ingredientId: z.string().min(1, "Ingredient ID is required"),
  triggerId: z.string().optional(),
  focusProductIds: z.array(z.string()).optional(),
  includeAiSuggestions: z.boolean().default(true),
});

export const WorkflowGeneratorInputSchema = z.object({
  decisionPackageId: z.string().min(1, "Decision package ID is required"),
  decision: z.enum(["accept", "reject", "defer", "partial"]),
  decisionNotes: z.string().max(5000).optional(),
  modifications: z.object({
    skipSteps: z.array(z.string()).optional(),
    addSteps: z.array(z.object({
      name: z.string(),
      description: z.string(),
      assignee: z.string().optional(),
    })).optional(),
    changeTimeline: z.object({ deadline: z.string() }).optional(),
  }).optional(),
});

export const ConversationMessageSchema = z.object({
  content: z.string().min(1, "Message content is required").max(5000, "Message too long"),
});
