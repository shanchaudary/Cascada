// Cascada — Workflows Module Index
// Public API for the workflow orchestration layer.
// All workflow interactions should go through this module.

// ============================================================================
// Types (re-exported for convenience)
// ============================================================================

export type {
  CascadaWorkflowType,
  WorkflowState,
  StepType,
  StepState,
  AssigneeRole,
  WorkflowStepDefinition,
  StepParameters,
  NotificationStepParams,
  TaskCreationStepParams,
  ErpUpdateStepParams,
  ApprovalStepParams,
  ReviewStepParams,
  TestingStepParams,
  RegulatoryFilingStepParams,
  SupplierNegotiationStepParams,
  ProductionChangeStepParams,
  LabelUpdateStepParams,
  QualityCheckStepParams,
  StakeholderCommunicationStepParams,
  StartWorkflowInput,
  WorkflowParams,
  ReformulationParams,
  LabelChangeParams,
  ProductWithdrawalParams,
  ComplianceReviewParams,
  StepOverride,
  WorkflowResult,
  StepExecutionResult,
  NotifyTeamInput,
  NotifyTeamOutput,
  CreateTasksInput,
  CreateTasksOutput,
  UpdateErpInput,
  UpdateErpOutput,
  ApprovalSignal,
  ReviewSignal,
  CancellationSignal,
  WorkflowStatus,
} from "./types";

export {
  WORKFLOW_TYPE_LABELS,
  WORKFLOW_TRANSITIONS,
  TEMPORAL_CONFIG,
  StartWorkflowInputSchema,
  ApprovalSignalSchema,
  ReviewSignalSchema,
  CancellationSignalSchema,
  NotifyTeamInputSchema,
  CreateTasksInputSchema,
  UpdateErpInputSchema,
} from "./types";

// ============================================================================
// Temporal Client
// ============================================================================

export {
  getTemporalConnection,
  getTemporalClient,
  getWorkflowClient,
  describeWorkflow,
  isWorkflowRunning,
  terminateWorkflow,
  cancelWorkflow,
  signalWorkflow,
  queryWorkflow,
  isTemporalHealthy,
  closeTemporalConnection,
} from "./client";

// ============================================================================
// Orchestrator (Primary API)
// ============================================================================

export {
  startWorkflow,
  approveWorkflowStep,
  reviewWorkflowStep,
  cancelWorkflowInstance,
  getWorkflowStatus,
  getWorkflowInstance,
  listWorkflows,
} from "./orchestrator";

// ============================================================================
// Workflow Definitions
// ============================================================================

export { reformulationWorkflow } from "./reformulation-workflow";
export type { ReformulationWorkflowInput } from "./reformulation-workflow";

export { labelChangeWorkflow } from "./label-change-workflow";
export type { LabelChangeWorkflowInput } from "./label-change-workflow";

export { productWithdrawalWorkflow } from "./product-withdrawal-workflow";
export type { ProductWithdrawalWorkflowInput } from "./product-withdrawal-workflow";

export { complianceReviewWorkflow } from "./compliance-review-workflow";
export type { ComplianceReviewWorkflowInput } from "./compliance-review-workflow";

// ============================================================================
// Activities
// ============================================================================

export { notifyTeam } from "./activities/notify-team";
export { createTasks, updateTaskStatus, getPendingTasksForUser } from "./activities/create-tasks";
export { updateErp } from "./activities/update-erp";
