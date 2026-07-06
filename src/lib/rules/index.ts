// Cascada — Rules Module Barrel Exports
// All rule engine functionality is accessed through this module.

// Parser
export {
  parseRegulatorySource,
  enrichSubstances,
  batchParseSources,
  type RuleParsingResult,
  type BatchParsingResult,
} from "./parser";

// Substance matcher
export {
  matchSubstancesDeterministic,
  matchSubstancesWithLlm,
  matchAllSubstances,
  type SubstanceMatcherInput,
  type MatchResult,
} from "./substance-matcher";

// Rule builder
export {
  buildRule,
  buildRulesFromParsed,
  checkRuleDuplicate,
  getRuleWithIngredients,
  getRulesAffectingTenant,
  type RuleBuildResult,
  type BulkBuildResult,
} from "./rule-builder";

// Versioning
export {
  getRuleVersionChain,
  supersedeRule,
  repealRule,
  diffRuleVersions,
  getLatestActiveRules,
  type RuleVersionHistory,
  type RuleVersionChain,
  type RuleVersionDiff,
} from "./versioning";

// Validation
export {
  getValidationQueue,
  validateRule,
  bulkValidateRules,
  getValidationStats,
  type SmeValidationInput,
  type SmeValidationResult,
  type ValidationQueueItem,
  type ValidationStats,
} from "./validation";
