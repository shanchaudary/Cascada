// Cascada — Workflow Type Definitions
// Shared types for Temporal workflows, activities, and orchestration.
// Covers all four workflow types: Reformulation, Label Change,
// Product Withdrawal, Compliance Review. Plus activity signatures,
// step state machines, and workflow lifecycle types.

import { z } from "zod";

// ============================================================================
// Workflow Identity & Lifecycle
// ============================================================================

/** The four primary workflow types in Cascada. Each maps to a Temporal workflow. */
export type CascadaWorkflowType =
  | "reformulation"
  | "label_change"
  | "product_withdrawal"
  | "compliance_review";

/** Human-readable labels for workflow types (used in notifications and UI) */
export const WORKFLOW_TYPE_LABELS: Record<CascadaWorkflowType, string> = {
  reformulation: "Reformulation",
  label_change: "Label Change",
  product_withdrawal: "Product Withdrawal",
  compliance_review: "Compliance Review",
};

/**
 * The high-level state of a workflow instance.
 * Mirrors WorkflowStatus from the Prisma schema but extended with
 * workflow-specific transitions and semantics.
 */
export type WorkflowState =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "awaiting_review"
  | "awaiting_erp_sync"
  | "awaiting_testing"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

/**
 * Valid state transitions for a workflow.
 * Each entry defines a from → to mapping with the triggering event.
 * Workflows can only transition along these edges — any other
 * transition is illegal and will throw WorkflowError.
 */
export const WORKFLOW_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  pending: ["running", "cancelled"],
  running: ["awaiting_approval", "awaiting_review", "awaiting_erp_sync", "awaiting_testing", "completed", "failed", "cancelled"],
  awaiting_approval: ["running", "completed", "failed", "timed_out", "cancelled"],
  awaiting_review: ["running", "awaiting_approval", "completed", "failed", "cancelled"],
  awaiting_erp_sync: ["running", "completed", "failed", "cancelled"],
  awaiting_testing: ["running", "awaiting_approval", "completed", "failed", "cancelled"],
  completed: [],
  failed: ["running"], // Retry from failure
  cancelled: [],
  timed_out: ["running"], // Retry after timeout
};

// ============================================================================
// Workflow Step Definitions
// ============================================================================

/**
 * Step types mirror the WorkflowStepType from agent types but are
 * scoped to the workflow execution layer (not agent generation).
 * These are the actual operations that Temporal activities perform.
 */
export type StepType =
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

/**
 * The execution state of an individual workflow step.
 * Steps progress linearly: pending → running → (completed | failed | skipped).
 */
export type StepState = "pending" | "running" | "completed" | "failed" | "skipped";

/** Who can be assigned a workflow step */
export type AssigneeRole =
  | "compliance_team"
  | "rd_team"
  | "quality_team"
  | "procurement_team"
  | "production_team"
  | "legal_team"
  | "executive"
  | "regulatory_affairs"
  | "marketing_team";

/**
 * A single step within a workflow definition.
 * Steps are the atomic units of work in a Cascada workflow.
 * Each step maps to one or more Temporal activities.
 */
export interface WorkflowStepDefinition {
  /** Unique identifier within this workflow */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Detailed description of what this step accomplishes */
  description: string;
  /** The type of operation this step performs */
  type: StepType;
  /** Which team or role is responsible */
  assignedRole: AssigneeRole;
  /** Specific user IDs assigned (overrides role-based assignment) */
  assignedUserIds?: string[];
  /** Step IDs that must complete before this step can start */
  dependsOn: string[];
  /** Whether this step requires human approval before proceeding */
  requiresApproval: boolean;
  /** Timeout in seconds for this step before escalation */
  timeoutSeconds: number;
  /** Whether this step is on the critical path */
  isCriticalPath: boolean;
  /** Estimated duration in days */
  estimatedDurationDays: number;
  /** Step-specific parameters (varies by StepType) */
  parameters: StepParameters;
}

/**
 * Step-specific parameters. Each step type has its own parameter shape.
 * Using a discriminated union for type safety.
 */
export type StepParameters =
  | NotificationStepParams
  | TaskCreationStepParams
  | ErpUpdateStepParams
  | ApprovalStepParams
  | ReviewStepParams
  | TestingStepParams
  | RegulatoryFilingStepParams
  | SupplierNegotiationStepParams
  | ProductionChangeStepParams
  | LabelUpdateStepParams
  | QualityCheckStepParams
  | StakeholderCommunicationStepParams;

export interface NotificationStepParams {
  type: "notification";
  /** Recipient roles or specific user IDs */
  recipients: Array<{ role?: AssigneeRole; userId?: string }>;
  /** Notification channel */
  channel: "email" | "in_app" | "slack" | "teams";
  /** Priority of the notification */
  priority: "low" | "normal" | "high" | "urgent";
  /** Template key for the notification */
  templateKey: string;
  /** Template variables */
  templateVariables: Record<string, string>;
}

export interface TaskCreationStepParams {
  type: "task_creation";
  /** Tasks to create */
  tasks: Array<{
    title: string;
    description: string;
    assignedRole: AssigneeRole;
    assignedUserId?: string;
    dueDateOffsetDays: number;
    priority: "low" | "normal" | "high" | "urgent";
  }>;
}

export interface ErpUpdateStepParams {
  type: "erp_update";
  /** ERP operation to perform */
  operation: "update_bom" | "update_item" | "update_supplier" | "update_pricing" | "deactivate_item";
  /** Entity IDs affected by this update */
  entityIds: string[];
  /** The data to update */
  updatePayload: Record<string, unknown>;
  /** Whether to sync immediately or batch */
  syncImmediately: boolean;
}

export interface ApprovalStepParams {
  type: "approval";
  /** Who can approve this step */
  approverRoles: AssigneeRole[];
  /** Specific user IDs who can approve */
  approverUserIds?: string[];
  /** Maximum time to wait for approval (seconds) */
  approvalTimeoutSeconds: number;
  /** What to do if approval times out */
  onTimeoutAction: "escalate" | "auto_approve" | "auto_reject" | "cancel_workflow";
  /** Escalation chain if timeout */
  escalationChain?: Array<{ role: AssigneeRole; timeoutSeconds: number }>;
}

export interface ReviewStepParams {
  type: "review";
  /** Who should review */
  reviewerRoles: AssigneeRole[];
  /** Review checklist items */
  checklist: Array<{ item: string; required: boolean }>;
  /** Documents to review */
  documentIds?: string[];
  /** Maximum review duration in seconds */
  reviewTimeoutSeconds: number;
}

export interface TestingStepParams {
  type: "testing";
  /** Type of testing required */
  testingType: "sensory" | "stability" | "microbiological" | "chemical" | "regulatory_compliance";
  /** Products to test */
  productIds: string[];
  /** Formulation IDs being tested */
  formulationIds: string[];
  /** Estimated testing duration in days */
  estimatedDurationDays: number;
  /** Testing protocol or standard to follow */
  protocol?: string;
}

export interface RegulatoryFilingStepParams {
  type: "regulatory_filing";
  /** Jurisdiction for the filing */
  jurisdiction: string;
  /** Filing type */
  filingType: "notification" | "pre_market_approval" | "registration" | "label_submission" | "gras_determination";
  /** Products included in the filing */
  productIds: string[];
  /** Required documents */
  requiredDocuments: string[];
  /** Filing deadline */
  deadlineDate: string;
}

export interface SupplierNegotiationStepParams {
  type: "supplier_negotiation";
  /** Supplier IDs to negotiate with */
  supplierIds: string[];
  /** Ingredient IDs being sourced */
  ingredientIds: string[];
  /** Negotiation objectives */
  objectives: Array<{
    type: "price_reduction" | "volume_commitment" | "quality_spec" | "lead_time" | "certification";
    description: string;
    targetValue?: string;
  }>;
  /** Maximum negotiation duration in days */
  maxDurationDays: number;
}

export interface ProductionChangeStepParams {
  type: "production_change";
  /** Products affected */
  productIds: string[];
  /** Formulation changes to implement */
  formulationChanges: Array<{
    formulationId: string;
    changeType: "ingredient_replacement" | "concentration_adjustment" | "new_formulation";
    details: Record<string, unknown>;
  }>;
  /** Production line(s) affected */
  productionLines?: string[];
  /** Cutover date for the change */
  cutoverDate?: string;
}

export interface LabelUpdateStepParams {
  type: "label_update";
  /** Products requiring label changes */
  productIds: string[];
  /** Types of label changes */
  changeTypes: Array<"warning_label" | "ingredient_list" | "nutritional_facts" | "allergen_declaration" | "country_of_origin" | "certification_mark">;
  /** Jurisdictions requiring the change */
  jurisdictions: string[];
  /** Deadline for label compliance */
  complianceDeadline: string;
}

export interface QualityCheckStepParams {
  type: "quality_check";
  /** Products to check */
  productIds: string[];
  /** Check type */
  checkType: "incoming_material" | "in_process" | "finished_product" | "shelf_life" | "sensory_panel" | "regulatory_compliance";
  /** Specifications to verify against */
  specificationIds: string[];
  /** Pass criteria */
  passCriteria: Array<{ metric: string; minValue?: number; maxValue?: number; unit?: string }>;
}

export interface StakeholderCommunicationStepParams {
  type: "stakeholder_communication";
  /** Stakeholders to communicate with */
  stakeholders: Array<{
    type: "customer" | "supplier" | "regulatory_body" | "internal_team" | "board";
    ids: string[];
  }>;
  /** Communication type */
  communicationType: "notification" | "report" | "meeting_request" | "documentation";
  /** Template or communication brief */
  templateKey: string;
  /** Key messages to convey */
  keyMessages: string[];
}

// ============================================================================
// Workflow Input / Output Types
// ============================================================================

/**
 * Input to start a workflow. This is the common envelope that all
 * four workflow types accept. Workflow-specific inputs are nested.
 */
export interface StartWorkflowInput {
  /** The tenant that owns this workflow */
  tenantId: string;
  /** The user who initiated the workflow */
  initiatedByUserId: string;
  /** Decision package that triggered this workflow (if any) */
  decisionPackageId?: string;
  /** Cascade trigger that caused the decision package (if any) */
  triggerId?: string;
  /** Workflow type to start */
  workflowType: CascadaWorkflowType;
  /** Workflow-type-specific input parameters */
  params: WorkflowParams;
  /** Custom step overrides from the workflow generator agent */
  stepOverrides?: StepOverride[];
  /** Overall deadline for the workflow */
  deadline?: string;
  /** Priority of the workflow instance */
  priority: "low" | "normal" | "high" | "urgent";
}

/**
 * Workflow-type-specific parameters.
 * Discriminated union keyed on the workflow type.
 */
export type WorkflowParams =
  | ReformulationParams
  | LabelChangeParams
  | ProductWithdrawalParams
  | ComplianceReviewParams;

/** Parameters for reformulation workflows */
export interface ReformulationParams {
  type: "reformulation";
  /** Ingredients to replace */
  targetIngredientIds: string[];
  /** Substitute ingredient IDs (if already chosen) */
  substituteIngredientIds?: string[];
  /** Products affected by the reformulation */
  affectedProductIds: string[];
  /** Formulation IDs to update */
  formulationIds: string[];
  /** Target compliance date */
  complianceDate: string;
  /** Maximum cost increase allowed (percentage) */
  maxCostIncreasePercent?: number;
  /** Whether sensory testing is required */
  requiresSensoryTesting: boolean;
  /** Whether stability testing is required */
  requiresStabilityTesting: boolean;
}

/** Parameters for label change workflows */
export interface LabelChangeParams {
  type: "label_change";
  /** Products requiring label changes */
  productIds: string[];
  /** Types of label changes needed */
  changeTypes: Array<"warning_label" | "ingredient_list" | "nutritional_facts" | "allergen_declaration" | "country_of_origin">;
  /** Jurisdictions requiring label changes */
  jurisdictions: string[];
  /** Compliance deadline for label updates */
  complianceDeadline: string;
  /** Whether new label copy needs legal review */
  requiresLegalReview: boolean;
  /** Whether to update packaging artwork */
  requiresArtworkUpdate: boolean;
}

/** Parameters for product withdrawal workflows */
export interface ProductWithdrawalParams {
  type: "product_withdrawal";
  /** Products to withdraw */
  productIds: string[];
  /** Reason for withdrawal */
  reason: "regulatory_ban" | "voluntary_recall" | "customer_mandate" | "safety_concern";
  /** Withdrawal scope */
  scope: "full_market" | "specific_jurisdictions" | "specific_retailers" | "specific_batches";
  /** Specific jurisdictions (if scope is specific_jurisdictions) */
  jurisdictions?: string[];
  /** Specific retailers (if scope is specific_retailers) */
  retailers?: string[];
  /** Batch numbers (if scope is specific_batches) */
  batchNumbers?: string[];
  /** Deadline for completing the withdrawal */
  withdrawalDeadline: string;
  /** Whether customer notification is required */
  requiresCustomerNotification: boolean;
}

/** Parameters for compliance review workflows */
export interface ComplianceReviewParams {
  type: "compliance_review";
  /** Regulations triggering this review */
  regulationIds: string[];
  /** Products under review */
  productIds: string[];
  /** Jurisdictions being reviewed */
  jurisdictions: string[];
  /** Review deadline */
  reviewDeadline: string;
  /** Whether external legal counsel is needed */
  requiresExternalCounsel: boolean;
  /** Whether to file pre-market notifications */
  requiresPreMarketNotification: boolean;
  /** Scope of the review */
  reviewScope: "full_portfolio" | "affected_products" | "specific_categories";
}

/**
 * Override for a step generated by the workflow generator agent.
 * Allows skipping, reordering, or modifying steps.
 */
export interface StepOverride {
  stepId: string;
  action: "skip" | "modify" | "add_dependency";
  modifications?: Partial<WorkflowStepDefinition>;
  newDependency?: string;
}

/**
 * Result returned when a workflow completes or is queried.
 * Contains the full execution trace and step-level results.
 */
export interface WorkflowResult {
  /** The workflow instance ID in our DB */
  workflowInstanceId: string;
  /** The Temporal workflow execution ID */
  temporalWorkflowId: string;
  /** The workflow type */
  workflowType: CascadaWorkflowType;
  /** Final state */
  state: WorkflowState;
  /** Step-level execution results */
  stepResults: StepExecutionResult[];
  /** Total execution duration in seconds */
  totalDurationSeconds: number;
  /** Total estimated cost of workflow execution */
  estimatedCost: number | null;
  /** Summary of what was accomplished */
  summary: string;
  /** Any warnings encountered */
  warnings: string[];
  /** Timestamp when workflow started */
  startedAt: string;
  /** Timestamp when workflow completed */
  completedAt?: string;
}

/**
 * Result from a single step execution.
 * Captures the outcome, artifacts, and timing for audit.
 */
export interface StepExecutionResult {
  /** Step definition ID */
  stepId: string;
  /** Step name */
  stepName: string;
  /** Final step state */
  state: StepState;
  /** Who approved or reviewed (if applicable) */
  approvedBy?: string;
  /** When the step started executing */
  startedAt: string;
  /** When the step completed */
  completedAt?: string;
  /** Duration in seconds */
  durationSeconds?: number;
  /** Step-specific output data */
  output?: Record<string, unknown>;
  /** Error message if step failed */
  error?: string;
  /** Retry count */
  retryCount: number;
}

// ============================================================================
// Activity Input / Output Types
// ============================================================================

/** Input for the notify-team activity */
export interface NotifyTeamInput {
  tenantId: string;
  workflowInstanceId: string;
  stepId: string;
  recipients: Array<{ role?: string; userId?: string; email?: string }>;
  channel: "email" | "in_app" | "slack" | "teams";
  priority: "low" | "normal" | "high" | "urgent";
  templateKey: string;
  templateVariables: Record<string, string>;
  /** ISO 8601 timestamp */
  triggeredAt: string;
}

/** Output from the notify-team activity */
export interface NotifyTeamOutput {
  notificationsSent: number;
  recipientIds: string[];
  channel: string;
  sentAt: string;
  /** IDs of notification records created */
  notificationIds: string[];
}

/** Input for the create-tasks activity */
export interface CreateTasksInput {
  tenantId: string;
  workflowInstanceId: string;
  stepId: string;
  tasks: Array<{
    title: string;
    description: string;
    assignedRole: string;
    assignedUserId?: string;
    dueDateOffsetDays: number;
    priority: "low" | "normal" | "high" | "urgent";
  }>;
  /** ISO 8601 timestamp */
  triggeredAt: string;
}

/** Output from the create-tasks activity */
export interface CreateTasksOutput {
  tasksCreated: number;
  taskIds: string[];
  /** Map of task title → assigned user ID */
  assignments: Record<string, string>;
  createdAt: string;
}

/** Input for the update-erp activity */
export interface UpdateErpInput {
  tenantId: string;
  workflowInstanceId: string;
  stepId: string;
  erpConnectionId: string;
  operation: "update_bom" | "update_item" | "update_supplier" | "update_pricing" | "deactivate_item";
  entityIds: string[];
  updatePayload: Record<string, unknown>;
  syncImmediately: boolean;
  /** ISO 8601 timestamp */
  triggeredAt: string;
}

/** Output from the update-erp activity */
export interface UpdateErpOutput {
  operation: string;
  entitiesUpdated: number;
  entityIds: string[];
  syncStatus: "synced" | "queued" | "partial" | "failed";
  errors: Array<{ entityId: string; error: string }>;
  completedAt: string;
}

// ============================================================================
// Approval & Signal Types
// ============================================================================

/** Signal sent to Temporal when a human approves or rejects a step */
export interface ApprovalSignal {
  /** Step ID being approved or rejected */
  stepId: string;
  /** The decision */
  decision: "approved" | "rejected";
  /** User ID of the approver */
  approverUserId: string;
  /** Optional notes */
  notes?: string;
  /** ISO 8601 timestamp */
  decidedAt: string;
}

/** Signal sent to Temporal when a review is completed */
export interface ReviewSignal {
  stepId: string;
  reviewerUserId: string;
  /** Checklist results */
  checklistResults: Array<{ item: string; passed: boolean; notes?: string }>;
  /** Overall review verdict */
  verdict: "pass" | "fail" | "conditional_pass";
  conditions?: string[];
  reviewedAt: string;
}

/** Signal sent when a cancellation is requested */
export interface CancellationSignal {
  reason: string;
  cancelledByUserId: string;
  cancelledAt: string;
}

// ============================================================================
// Workflow Query Types
// ============================================================================

/** Current status of a running workflow, queryable from Temporal */
export interface WorkflowStatus {
  workflowType: CascadaWorkflowType;
  state: WorkflowState;
  currentStepId: string | null;
  currentStepName: string | null;
  completedStepIds: string[];
  pendingStepIds: string[];
  totalSteps: number;
  progressPercent: number;
  startedAt: string;
  estimatedCompletionAt?: string;
  awaitingActionFrom?: Array<{ stepId: string; stepName: string; assignedRole: string }>;
}

// ============================================================================
// Temporal Configuration
// ============================================================================

/** Temporal connection and execution configuration */
export const TEMPORAL_CONFIG = {
  /** Task queue name for Cascada workflows */
  TASK_QUEUE: "cascada-tasks",
  /** Namespace for Cascada workflows */
  NAMESPACE: "cascada",
  /** Default workflow execution timeout (7 days) */
  DEFAULT_EXECUTION_TIMEOUT_MS: 7 * 24 * 60 * 60 * 1000,
  /** Default step timeout (24 hours) */
  DEFAULT_STEP_TIMEOUT_MS: 24 * 60 * 60 * 1000,
  /** Default approval timeout (3 business days) */
  DEFAULT_APPROVAL_TIMEOUT_MS: 3 * 24 * 60 * 60 * 1000,
  /** Maximum retry attempts for activities */
  MAX_ACTIVITY_RETRIES: 3,
  /** Backoff coefficient for activity retries */
  RETRY_BACKOFF_COEFFICIENT: 2,
  /** Initial retry interval in ms */
  INITIAL_RETRY_INTERVAL_MS: 1000,
  /** Maximum retry interval in ms */
  MAX_RETRY_INTERVAL_MS: 60000,
  /** Workflow ID prefix for each type */
  WORKFLOW_ID_PREFIXES: {
    reformulation: "reform",
    label_change: "label",
    product_withdrawal: "withdraw",
    compliance_review: "comply",
  } as const,
} as const;

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const ApprovalSignalSchema = z.object({
  stepId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  approverUserId: z.string().min(1),
  notes: z.string().optional(),
  decidedAt: z.string().datetime(),
});

export const ReviewSignalSchema = z.object({
  stepId: z.string().min(1),
  reviewerUserId: z.string().min(1),
  checklistResults: z.array(z.object({
    item: z.string(),
    passed: z.boolean(),
    notes: z.string().optional(),
  })),
  verdict: z.enum(["pass", "fail", "conditional_pass"]),
  conditions: z.array(z.string()).optional(),
  reviewedAt: z.string().datetime(),
});

export const CancellationSignalSchema = z.object({
  reason: z.string().min(1),
  cancelledByUserId: z.string().min(1),
  cancelledAt: z.string().datetime(),
});

export const StartWorkflowInputSchema = z.object({
  tenantId: z.string().min(1),
  initiatedByUserId: z.string().min(1),
  decisionPackageId: z.string().optional(),
  triggerId: z.string().optional(),
  workflowType: z.enum(["reformulation", "label_change", "product_withdrawal", "compliance_review"]),
  params: z.unknown(), // Validated per type in orchestrator
  stepOverrides: z.array(z.object({
    stepId: z.string(),
    action: z.enum(["skip", "modify", "add_dependency"]),
    modifications: z.unknown().optional(),
    newDependency: z.string().optional(),
  })).optional(),
  deadline: z.string().datetime().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
});

export const NotifyTeamInputSchema = z.object({
  tenantId: z.string().min(1),
  workflowInstanceId: z.string().min(1),
  stepId: z.string().min(1),
  recipients: z.array(z.object({
    role: z.string().optional(),
    userId: z.string().optional(),
    email: z.string().email().optional(),
  })).min(1),
  channel: z.enum(["email", "in_app", "slack", "teams"]),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  templateKey: z.string().min(1),
  templateVariables: z.record(z.string()),
  triggeredAt: z.string().datetime(),
});

export const CreateTasksInputSchema = z.object({
  tenantId: z.string().min(1),
  workflowInstanceId: z.string().min(1),
  stepId: z.string().min(1),
  tasks: z.array(z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    assignedRole: z.string().min(1),
    assignedUserId: z.string().optional(),
    dueDateOffsetDays: z.number().int().positive(),
    priority: z.enum(["low", "normal", "high", "urgent"]),
  })).min(1),
  triggeredAt: z.string().datetime(),
});

export const UpdateErpInputSchema = z.object({
  tenantId: z.string().min(1),
  workflowInstanceId: z.string().min(1),
  stepId: z.string().min(1),
  erpConnectionId: z.string().min(1),
  operation: z.enum(["update_bom", "update_item", "update_supplier", "update_pricing", "deactivate_item"]),
  entityIds: z.array(z.string()).min(1),
  updatePayload: z.record(z.unknown()),
  syncImmediately: z.boolean(),
  triggeredAt: z.string().datetime(),
});
