// Cascada — Hook Barrel Exports
// Re-exports all custom React hooks from a single entry point.

// Dashboard hooks
export {
  dashboardKeys,
  useDashboardSummary,
  useExposureByState,
  useExposureByProduct,
  useUpcomingDeadlines,
  useRecentTriggers,
  useCostEstimates,
} from "./use-dashboard";

// Cascade hooks
export {
  cascadeKeys,
  useCascadeGraph,
  useCascadeStats,
  useCascadeTriggers,
  useCascadeTriggerDetail,
  useAnalyzeTrigger,
  useCascadeImpacts,
  useCascadeExposure,
} from "./use-cascade";

// Regulatory hooks
export {
  regulatoryKeys,
  useRegulatorySources,
  useRegulatorySourceDetail,
  useProcessSource,
  useValidateSource,
  useRegulatoryRules,
  useRegulatoryRuleDetail,
  useRegulatorySearch,
} from "./use-regulatory";

// ERP hooks
export {
  erpKeys,
  useErpConnections,
  useErpConnectionDetail,
  useErpSync,
  useErpHealth,
} from "./use-erp";

// Data hooks (ingredients, formulations, products)
export {
  dataKeys,
  useIngredients,
  useIngredientDetail,
  useIngredientSubstitutions,
  useFormulations,
  useFormulationDetail,
  useProducts,
  useProductDetail,
  useProductExposure,
} from "./use-data";

// Decision hooks
export {
  decisionKeys,
  useDecisions,
  useDecisionDetail,
  useDecide,
  useDecisionReport,
} from "./use-decisions";

// Workflow hooks
export {
  workflowKeys,
  useWorkflows,
  useWorkflowDetail,
  useApproveWorkflow,
  useRejectWorkflow,
  useWorkflowSteps,
} from "./use-workflows";
