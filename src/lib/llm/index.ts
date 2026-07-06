// Cascada — LLM Module Barrel Exports
// All LLM functionality is accessed through this module.

// Client
export {
  getModel,
  getPrimaryModel,
  getFallbackModel,
  getTemperatureForTask,
  getModelIdForTask,
  getFallbackModelIdForTask,
  calculateLlmCost,
  isRetryableLlmError,
  isStructuredOutputRetryable,
  type LlmTaskType,
} from "./client";

// Structured output
export {
  generateStructuredOutput,
  ParsedRuleSchema,
  SubstanceExtractionSchema,
  IngredientMatchSchema,
  type ParsedRuleOutput,
  type SubstanceExtractionOutput,
  type IngredientMatchOutput,
} from "./structured-output";

// Cost tracking
export {
  logLlmUsage,
  getLlmUsageSummary,
  checkLlmBudget,
  type LlmUsageLogEntry,
  type LlmUsageSummary,
  type LlmBudget,
} from "./cost-tracker";

// Fallback
export {
  executeWithFallback,
  retryWithBackoff,
  processBatchWithConcurrency,
  type FallbackResult,
} from "./fallback";

// Prompts
export {
  RULE_PARSER_PROMPT_VERSION,
  RULE_PARSER_SYSTEM_PROMPT,
  buildRuleParserPrompt,
  type RuleParserPromptInput,
} from "./prompts/rule-parser";

export {
  SUBSTANCE_EXTRACTOR_PROMPT_VERSION,
  SUBSTANCE_EXTRACTOR_SYSTEM_PROMPT,
  buildSubstanceExtractorPrompt,
  type SubstanceExtractorPromptInput,
} from "./prompts/substance-extractor";

export {
  QUERY_AGENT_PROMPT_VERSION,
  QUERY_AGENT_SYSTEM_PROMPT,
  buildQueryAgentPrompt,
  type QueryAgentPromptInput,
} from "./prompts/query-agent";

export {
  REFORMULATION_ADVISOR_PROMPT_VERSION,
  REFORMULATION_ADVISOR_SYSTEM_PROMPT,
  buildReformulationAdvisorPrompt,
  type ReformulationAdvisorPromptInput,
} from "./prompts/reformulation-advisor";
