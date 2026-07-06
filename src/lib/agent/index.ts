// Cascada — Agent Module Barrel Exports
// All AI agent functionality is exported from this module.

// Types
export type {
  AgentType,
  AgentMessage,
  Conversation,
  ConversationStatus,
  RAGContext,
  RegulationContextItem,
  ProductContextItem,
  ImpactContextItem,
  TimelineContextItem,
  IngredientContextItem,
  DecisionPackageContextItem,
  AgentToolCall,
  ToolName,
  AgentToolDefinition,
  AgentExecutionContext,
  AgentExecutionResult,
  ExecutiveQueryInput,
  ExecutiveQueryResult,
  QueryIntent,
  ReformulationInput,
  ReformulationResult,
  ReformulationSubstitute,
  WorkflowGeneratorInput,
  WorkflowGeneratorResult,
  GeneratedWorkflow,
  GeneratedWorkflowStep,
  WorkflowType,
  WorkflowStepType,
} from "./types";

export {
  AGENT_CONFIG,
  AGENT_IDENTITIES,
  ExecutiveQueryInputSchema,
  ReformulationInputSchema,
  WorkflowGeneratorInputSchema,
  ConversationMessageSchema,
} from "./types";

// Context builder
export { buildAgentContext, serializeContextForPrompt } from "./context";
export type { ContextRetrievalOptions } from "./context";

// Tool definitions and execution
export {
  AGENT_TOOLS,
  executeToolCall,
  getAvailableTools,
  formatToolDefinitionsForPrompt,
  SearchRegulationsSchema,
  SearchProductsSchema,
  GetCascadeImpactsSchema,
  GetComplianceTimelinesSchema,
  GetIngredientDetailsSchema,
  GetReformulationOptionsSchema,
  GetDecisionPackageSchema,
  GenerateDecisionPackageSchema,
  EstimateReformulationCostSchema,
  GenerateWorkflowSchema,
} from "./tools";

// Agents
export { executeExecutiveQueryAgent } from "./executive-query";
export { executeReformulationAgent } from "./reformulation";
export { executeWorkflowGeneratorAgent } from "./workflow-generator";

// Schemas
export { ExecutiveQueryResultSchema } from "./executive-query";
export { ReformulationOutputSchema } from "./reformulation";
export { WorkflowOutputSchema } from "./workflow-generator";
