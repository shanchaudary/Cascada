// Cascada — Workflow Orchestrator
// High-level service that bridges the application layer to Temporal workflows.
// The orchestrator handles:
// - Starting workflows from decision packages
// - Building step definitions from workflow generator agent output
// - Managing workflow instance records in the database
// - Sending signals (approvals, reviews, cancellations)
// - Querying workflow status
// - Handling workflow results on completion
//
// This is the ONLY place in the application that should directly interact
// with Temporal client APIs. All other modules use the orchestrator.

import { prisma, withTenant } from "@/lib/db";
import { createWorkflowLogger } from "@/lib/logger";
import {
  WorkflowError,
  WorkflowNotFoundError,
  WorkflowAlreadyRunningError,
  NotFoundError,
  AuthorizationError,
} from "@/lib/errors";
import { getWorkflowClient, isWorkflowRunning, signalWorkflow, queryWorkflow, cancelWorkflow } from "./client";
import type {
  StartWorkflowInput,
  CascadaWorkflowType,
  WorkflowParams,
  WorkflowStepDefinition,
  WorkflowResult,
  WorkflowStatus,
  ApprovalSignal,
  ReviewSignal,
  CancellationSignal,
  StepOverride,
  ReformulationParams,
  LabelChangeParams,
  ProductWithdrawalParams,
  ComplianceReviewParams,
} from "./types";
import {
  TEMPORAL_CONFIG,
  StartWorkflowInputSchema,
  ApprovalSignalSchema,
  ReviewSignalSchema,
  CancellationSignalSchema,
} from "./types";
import { reformulationWorkflow } from "./reformulation-workflow";
import { labelChangeWorkflow } from "./label-change-workflow";
import { productWithdrawalWorkflow } from "./product-withdrawal-workflow";
import { complianceReviewWorkflow } from "./compliance-review-workflow";

const logger = createWorkflowLogger("orchestrator");

// ============================================================================
// Start Workflow
// ============================================================================

/**
 * Start a new workflow instance.
 *
 * This is the primary entry point for creating workflows. It:
 * 1. Validates the input parameters
 * 2. Checks that no conflicting workflow is already running
 * 3. Creates a WorkflowInstance record in the database
 * 4. Builds the step definitions from the input params
 * 5. Starts the Temporal workflow execution
 * 6. Updates the database record with the Temporal workflow ID
 *
 * Returns the workflow instance ID and Temporal workflow ID.
 */
export async function startWorkflow(
  input: StartWorkflowInput
): Promise<{ workflowInstanceId: string; temporalWorkflowId: string }> {
  // Validate input
  const parsed = StartWorkflowInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowError(
      `Invalid workflow start input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      input.workflowType,
      { validationErrors: parsed.error.issues }
    );
  }

  const validated = parsed.data;
  const log = logger.child({ workflowType: validated.workflowType, tenantId: validated.tenantId });

  log.info("Starting workflow");

  try {
    // Check for already-running workflow for the same trigger
    if (validated.triggerId) {
      const isRunning = await isWorkflowRunningForTrigger(
        validated.tenantId,
        validated.triggerId,
        validated.workflowType
      );
      if (isRunning) {
        throw new WorkflowAlreadyRunningError(validated.triggerId, validated.workflowType);
      }
    }

    // Build step definitions from the workflow params and overrides
    const steps = buildStepDefinitions(validated.workflowType, validated.params as WorkflowParams, validated.stepOverrides as StepOverride[]);

    // Generate a unique workflow ID
    const workflowInstanceId = generateWorkflowInstanceId(validated.workflowType);
    const temporalWorkflowId = `${TEMPORAL_CONFIG.WORKFLOW_ID_PREFIXES[validated.workflowType]}_${validated.tenantId.slice(0, 8)}_${Date.now()}`;

    // Create WorkflowInstance record in database
    await withTenant(validated.tenantId, async () => {
      await prisma.workflowInstance.create({
        data: {
          id: workflowInstanceId,
          tenantId: validated.tenantId,
          decisionPackageId: validated.decisionPackageId,
          workflowType: validated.workflowType,
          status: "PENDING",
          currentStep: steps[0]?.id ?? null,
          steps: steps.map((step) => ({
            id: step.id,
            name: step.name,
            type: step.parameters.type,
            assignedRole: step.assignedRole,
            dependsOn: step.dependsOn,
            requiresApproval: step.requiresApproval,
            isCriticalPath: step.isCriticalPath,
            estimatedDurationDays: step.estimatedDurationDays,
          })),
          assignedTo: [],
        },
      });
    });

    // Start the Temporal workflow
    const workflowClient = await getWorkflowClient();

    const workflowInput = {
      tenantId: validated.tenantId,
      workflowInstanceId,
      initiatedByUserId: validated.initiatedByUserId,
      params: validated.params as WorkflowParams,
      steps,
      deadline: validated.deadline,
      priority: validated.priority,
    };

    const handle = await workflowClient.start(getWorkflowFunction(validated.workflowType), {
      workflowId: temporalWorkflowId,
      taskQueue: TEMPORAL_CONFIG.TASK_QUEUE,
      args: [workflowInput as Parameters<typeof reformulationWorkflow>[0]],
      workflowExecutionTimeout: validated.deadline
        ? Math.min(
            TEMPORAL_CONFIG.DEFAULT_EXECUTION_TIMEOUT_MS,
            new Date(validated.deadline).getTime() - Date.now()
          )
        : TEMPORAL_CONFIG.DEFAULT_EXECUTION_TIMEOUT_MS,
      searchAttributes: {
        TenantId: [validated.tenantId],
        WorkflowType: [validated.workflowType],
        Priority: [validated.priority],
      },
    });

    // Update database with Temporal workflow ID
    await withTenant(validated.tenantId, async () => {
      await prisma.workflowInstance.update({
        where: { id: workflowInstanceId },
        data: {
          temporalWorkflowId: handle.workflowId,
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
    });

    log.info(
      { workflowInstanceId, temporalWorkflowId: handle.workflowId },
      "Workflow started successfully"
    );

    return {
      workflowInstanceId,
      temporalWorkflowId: handle.workflowId,
    };
  } catch (error) {
    if (error instanceof WorkflowAlreadyRunningError || error instanceof WorkflowError) throw error;

    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, "Failed to start workflow");
    throw new WorkflowError(
      `Failed to start workflow: ${message}`,
      validated.workflowType,
      { tenantId: validated.tenantId }
    );
  }
}

// ============================================================================
// Signal Operations
// ============================================================================

/**
 * Send an approval signal to a running workflow.
 * Used when a human approves or rejects a workflow step.
 */
export async function approveWorkflowStep(
  tenantId: string,
  workflowInstanceId: string,
  signal: ApprovalSignal
): Promise<void> {
  const parsed = ApprovalSignalSchema.safeParse(signal);
  if (!parsed.success) {
    throw new WorkflowError(
      `Invalid approval signal: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      "unknown",
      { validationErrors: parsed.error.issues }
    );
  }

  const temporalWorkflowId = await getTemporalId(tenantId, workflowInstanceId);
  if (!temporalWorkflowId) {
    throw new WorkflowNotFoundError(workflowInstanceId);
  }

  await signalWorkflow(temporalWorkflowId, "approval", parsed.data);

  // Audit log
  await withTenant(tenantId, async () => {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: parsed.data.approverUserId,
        action: parsed.data.decision === "approved" ? "workflow_step_approved" : "workflow_step_rejected",
        entityType: "workflow_instance",
        entityId: workflowInstanceId,
        newValue: {
          stepId: parsed.data.stepId,
          decision: parsed.data.decision,
          notes: parsed.data.notes,
        },
      },
    });
  });

  logger.info(
    { workflowInstanceId, stepId: parsed.data.stepId, decision: parsed.data.decision },
    "Workflow step approval signal sent"
  );
}

/**
 * Send a review signal to a running workflow.
 * Used when a reviewer completes their assessment of a workflow step.
 */
export async function reviewWorkflowStep(
  tenantId: string,
  workflowInstanceId: string,
  signal: ReviewSignal
): Promise<void> {
  const parsed = ReviewSignalSchema.safeParse(signal);
  if (!parsed.success) {
    throw new WorkflowError(
      `Invalid review signal: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      "unknown",
      { validationErrors: parsed.error.issues }
    );
  }

  const temporalWorkflowId = await getTemporalId(tenantId, workflowInstanceId);
  if (!temporalWorkflowId) {
    throw new WorkflowNotFoundError(workflowInstanceId);
  }

  await signalWorkflow(temporalWorkflowId, "review", parsed.data);

  // Audit log
  await withTenant(tenantId, async () => {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: parsed.data.reviewerUserId,
        action: "workflow_step_reviewed",
        entityType: "workflow_instance",
        entityId: workflowInstanceId,
        newValue: {
          stepId: parsed.data.stepId,
          verdict: parsed.data.verdict,
          conditions: parsed.data.conditions,
        },
      },
    });
  });

  logger.info(
    { workflowInstanceId, stepId: parsed.data.stepId, verdict: parsed.data.verdict },
    "Workflow step review signal sent"
  );
}

/**
 * Cancel a running workflow.
 * Unlike termination, cancellation allows the workflow to perform
 * cleanup before stopping.
 */
export async function cancelWorkflowInstance(
  tenantId: string,
  workflowInstanceId: string,
  signal: CancellationSignal
): Promise<void> {
  const parsed = CancellationSignalSchema.safeParse(signal);
  if (!parsed.success) {
    throw new WorkflowError(
      `Invalid cancellation signal: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      "unknown",
      { validationErrors: parsed.error.issues }
    );
  }

  const temporalWorkflowId = await getTemporalId(tenantId, workflowInstanceId);
  if (!temporalWorkflowId) {
    throw new WorkflowNotFoundError(workflowInstanceId);
  }

  // Send cancellation signal
  await signalWorkflow(temporalWorkflowId, "cancel", parsed.data);

  // Also cancel via Temporal for safety
  await cancelWorkflow(temporalWorkflowId);

  // Update database
  await withTenant(tenantId, async () => {
    await prisma.workflowInstance.update({
      where: { id: workflowInstanceId },
      data: {
        status: "CANCELLED",
        errorDetail: `Cancelled by ${parsed.data.cancelledByUserId}: ${parsed.data.reason}`,
      },
    });
  });

  logger.info({ workflowInstanceId, reason: parsed.data.reason }, "Workflow cancelled");
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Get the current status of a workflow.
 * Queries the Temporal workflow directly for real-time status.
 */
export async function getWorkflowStatus(
  tenantId: string,
  workflowInstanceId: string
): Promise<WorkflowStatus> {
  const temporalWorkflowId = await getTemporalId(tenantId, workflowInstanceId);
  if (!temporalWorkflowId) {
    throw new WorkflowNotFoundError(workflowInstanceId);
  }

  return queryWorkflow<WorkflowStatus>(temporalWorkflowId, "status");
}

/**
 * Get a workflow instance from the database.
 * Returns the persisted record with steps and status history.
 */
export async function getWorkflowInstance(
  tenantId: string,
  workflowInstanceId: string
): Promise<Record<string, unknown>> {
  return withTenant(tenantId, async () => {
    const instance = await prisma.workflowInstance.findUnique({
      where: { id: workflowInstanceId },
    });

    if (!instance) {
      throw new WorkflowNotFoundError(workflowInstanceId);
    }

    return {
      id: instance.id,
      tenantId: instance.tenantId,
      workflowType: instance.workflowType,
      status: instance.status,
      currentStep: instance.currentStep,
      steps: instance.steps,
      assignedTo: instance.assignedTo,
      temporalWorkflowId: instance.temporalWorkflowId,
      startedAt: instance.startedAt?.toISOString(),
      completedAt: instance.completedAt?.toISOString(),
      errorDetail: instance.errorDetail,
      createdAt: instance.createdAt.toISOString(),
      updatedAt: instance.updatedAt.toISOString(),
    };
  });
}

/**
 * List all workflow instances for a tenant.
 * Supports filtering by status and workflow type.
 */
export async function listWorkflows(
  tenantId: string,
  filters?: {
    status?: string;
    workflowType?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ workflows: Array<Record<string, unknown>>; total: number }> {
  return withTenant(tenantId, async () => {
    const where: Record<string, unknown> = { tenantId };
    if (filters?.status) where["status"] = filters.status;
    if (filters?.workflowType) where["workflowType"] = filters.workflowType;

    const [instances, total] = await Promise.all([
      prisma.workflowInstance.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: filters?.limit ?? 50,
        skip: filters?.offset ?? 0,
      }),
      prisma.workflowInstance.count({ where }),
    ]);

    return {
      workflows: instances.map((instance) => ({
        id: instance.id,
        tenantId: instance.tenantId,
        workflowType: instance.workflowType,
        status: instance.status,
        currentStep: instance.currentStep,
        startedAt: instance.startedAt?.toISOString(),
        completedAt: instance.completedAt?.toISOString(),
        createdAt: instance.createdAt.toISOString(),
        updatedAt: instance.updatedAt.toISOString(),
      })),
      total,
    };
  });
}

// ============================================================================
// Step Definition Builder
// ============================================================================

/**
 * Build step definitions for a workflow type from the input parameters.
 * This translates the high-level workflow params into concrete step
 * definitions with dependencies, timeouts, and assignees.
 *
 * If the workflow was generated by the AI agent, the steps may already
 * be defined — in that case, we convert them and apply overrides.
 * If not, we build default steps based on the workflow type.
 */
function buildStepDefinitions(
  workflowType: CascadaWorkflowType,
  params: WorkflowParams,
  overrides?: StepOverride[]
): WorkflowStepDefinition[] {
  // Build default steps based on workflow type
  let steps: WorkflowStepDefinition[];

  switch (workflowType) {
    case "reformulation":
      steps = buildReformulationSteps(params as ReformulationParams);
      break;
    case "label_change":
      steps = buildLabelChangeSteps(params as LabelChangeParams);
      break;
    case "product_withdrawal":
      steps = buildProductWithdrawalSteps(params as ProductWithdrawalParams);
      break;
    case "compliance_review":
      steps = buildComplianceReviewSteps(params as ComplianceReviewParams);
      break;
    default:
      throw new WorkflowError(`Unknown workflow type: ${workflowType}`, workflowType);
  }

  // Apply overrides
  if (overrides && overrides.length > 0) {
    steps = applyStepOverrides(steps, overrides);
  }

  return steps;
}

/**
 * Build default reformulation workflow steps.
 * Creates a standard 8-step reformulation process:
 * 1. Stakeholder notification
 * 2. R&D substitute evaluation
 * 3. R&D review gate
 * 4. Sensory testing (if required)
 * 5. Stability testing (if required)
 * 6. Quality approval
 * 7. ERP BOM update
 * 8. Production cutover notification
 */
function buildReformulationSteps(params: ReformulationParams): WorkflowStepDefinition[] {
  const steps: WorkflowStepDefinition[] = [];
  let stepIndex = 0;

  // Step 1: Notify stakeholders
  steps.push({
    id: `step_${++stepIndex}_notify`,
    name: "Stakeholder Notification",
    description: `Notify all stakeholders that reformulation is starting for ingredients: ${params.targetIngredientIds.join(", ")}`,
    type: "notification",
    assignedRole: "compliance_team",
    dependsOn: [],
    requiresApproval: false,
    timeoutSeconds: 3600, // 1 hour
    isCriticalPath: false,
    estimatedDurationDays: 0,
    parameters: {
      type: "notification",
      recipients: [
        { role: "compliance_team" },
        { role: "rd_team" },
        { role: "procurement_team" },
        { role: "production_team" },
      ],
      channel: "email",
      priority: "high",
      templateKey: "reformulation.started",
      templateVariables: {
        ingredients: params.targetIngredientIds.join(", "),
        products: params.affectedProductIds.join(", "),
        deadline: params.complianceDate,
      },
    },
  });

  // Step 2: R&D substitute evaluation tasks
  steps.push({
    id: `step_${++stepIndex}_rd_eval`,
    name: "R&D Substitute Evaluation",
    description: "Create tasks for R&D team to evaluate and test substitute ingredients",
    type: "task_creation",
    assignedRole: "rd_team",
    dependsOn: [steps[0]!.id],
    requiresApproval: false,
    timeoutSeconds: 86400, // 1 day
    isCriticalPath: true,
    estimatedDurationDays: 5,
    parameters: {
      type: "task_creation",
      tasks: params.targetIngredientIds.map((ingredientId) => ({
        title: `Evaluate substitute for ingredient ${ingredientId}`,
        description: `Research and evaluate substitute ingredients for ${ingredientId}. Consider: feasibility, sensory impact, shelf life, regulatory compliance, and cost.`,
        assignedRole: "rd_team",
        dueDateOffsetDays: 5,
        priority: "high",
      })),
    },
  });

  // Step 3: R&D review gate
  steps.push({
    id: `step_${++stepIndex}_rd_review`,
    name: "R&D Substitute Review",
    description: "Review and approve the proposed substitute ingredients",
    type: "approval",
    assignedRole: "rd_team",
    dependsOn: [steps[1]!.id],
    requiresApproval: true,
    timeoutSeconds: 3 * 86400, // 3 days
    isCriticalPath: true,
    estimatedDurationDays: 2,
    parameters: {
      type: "approval",
      approverRoles: ["rd_team", "compliance_team"],
      approvalTimeoutSeconds: 3 * 86400,
      onTimeoutAction: "escalate",
      escalationChain: [
        { role: "executive", timeoutSeconds: 86400 },
      ],
    },
  });

  // Step 4: Sensory testing (conditional)
  if (params.requiresSensoryTesting) {
    steps.push({
      id: `step_${++stepIndex}_sensory`,
      name: "Sensory Testing",
      description: "Conduct sensory panel testing on reformulated products",
      type: "testing",
      assignedRole: "quality_team",
      dependsOn: [steps[2]!.id],
      requiresApproval: false,
      timeoutSeconds: 14 * 86400, // 14 days
      isCriticalPath: true,
      estimatedDurationDays: 10,
      parameters: {
        type: "testing",
        testingType: "sensory",
        productIds: params.affectedProductIds,
        formulationIds: params.formulationIds,
        estimatedDurationDays: 10,
      },
    });
  }

  // Step 5: Stability testing (conditional)
  if (params.requiresStabilityTesting) {
    steps.push({
      id: `step_${++stepIndex}_stability`,
      name: "Stability Testing",
      description: "Conduct stability testing on reformulated products",
      type: "testing",
      assignedRole: "quality_team",
      dependsOn: [steps[2]!.id], // Can run in parallel with sensory
      requiresApproval: false,
      timeoutSeconds: 30 * 86400, // 30 days
      isCriticalPath: false,
      estimatedDurationDays: 21,
      parameters: {
        type: "testing",
        testingType: "stability",
        productIds: params.affectedProductIds,
        formulationIds: params.formulationIds,
        estimatedDurationDays: 21,
      },
    });
  }

  // Step 6: Quality approval
  const testingDepIds = steps
    .filter((s) => s.parameters.type === "testing")
    .map((s) => s.id);
  steps.push({
    id: `step_${++stepIndex}_qa_approval`,
    name: "Quality Approval",
    description: "Quality team reviews test results and approves the reformulation",
    type: "approval",
    assignedRole: "quality_team",
    dependsOn: testingDepIds.length > 0 ? testingDepIds : [steps[2]!.id],
    requiresApproval: true,
    timeoutSeconds: 3 * 86400,
    isCriticalPath: true,
    estimatedDurationDays: 2,
    parameters: {
      type: "approval",
      approverRoles: ["quality_team"],
      approvalTimeoutSeconds: 3 * 86400,
      onTimeoutAction: "escalate",
      escalationChain: [{ role: "executive", timeoutSeconds: 86400 }],
    },
  });

  // Step 7: ERP BOM update
  steps.push({
    id: `step_${++stepIndex}_erp_update`,
    name: "ERP BOM Update",
    description: "Update Bills of Materials in the ERP system with new formulations",
    type: "erp_update",
    assignedRole: "production_team",
    dependsOn: [steps[steps.length - 1]!.id],
    requiresApproval: false,
    timeoutSeconds: 86400,
    isCriticalPath: true,
    estimatedDurationDays: 1,
    parameters: {
      type: "erp_update",
      operation: "update_bom",
      entityIds: params.formulationIds,
      updatePayload: {
        changeReason: "Regulatory compliance reformulation",
        complianceDate: params.complianceDate,
      },
      syncImmediately: true,
    },
  });

  // Step 8: Completion notification
  steps.push({
    id: `step_${++stepIndex}_completion`,
    name: "Completion Notification",
    description: "Notify all stakeholders that the reformulation is complete",
    type: "notification",
    assignedRole: "compliance_team",
    dependsOn: [steps[steps.length - 1]!.id],
    requiresApproval: false,
    timeoutSeconds: 3600,
    isCriticalPath: false,
    estimatedDurationDays: 0,
    parameters: {
      type: "notification",
      recipients: [
        { role: "compliance_team" },
        { role: "rd_team" },
        { role: "production_team" },
        { role: "executive" },
      ],
      channel: "email",
      priority: "normal",
      templateKey: "workflow.completed",
      templateVariables: {
        workflowType: "Reformulation",
        duration: "TBD",
        stepsCompleted: String(steps.length),
        summary: "Reformulation completed successfully",
      },
    },
  });

  return steps;
}

/**
 * Build default label change workflow steps.
 */
function buildLabelChangeSteps(params: LabelChangeParams): WorkflowStepDefinition[] {
  const steps: WorkflowStepDefinition[] = [];
  let idx = 0;

  steps.push({
    id: `step_${++idx}_notify`,
    name: "Label Change Notification",
    description: `Notify teams of required label changes: ${params.changeTypes.join(", ")}`,
    type: "notification",
    assignedRole: "compliance_team",
    dependsOn: [],
    requiresApproval: false,
    timeoutSeconds: 3600,
    isCriticalPath: false,
    estimatedDurationDays: 0,
    parameters: {
      type: "notification",
      recipients: [{ role: "compliance_team" }, { role: "rd_team" }, { role: "marketing_team" }],
      channel: "email",
      priority: "high",
      templateKey: "label_change.started",
      templateVariables: {
        productCount: String(params.productIds.length),
        changeTypes: params.changeTypes.join(", "),
        jurisdictions: params.jurisdictions.join(", "),
        deadline: params.complianceDeadline,
      },
    },
  });

  steps.push({
    id: `step_${++idx}_copy_gen`,
    name: "Label Copy Generation",
    description: "Create tasks for generating updated label copy",
    type: "task_creation",
    assignedRole: "compliance_team",
    dependsOn: [steps[0]!.id],
    requiresApproval: false,
    timeoutSeconds: 86400,
    isCriticalPath: true,
    estimatedDurationDays: 3,
    parameters: {
      type: "task_creation",
      tasks: params.changeTypes.map((changeType) => ({
        title: `Generate ${changeType.replace(/_/g, " ")} copy`,
        description: `Draft updated label copy for ${changeType} requirements in ${params.jurisdictions.join(", ")}`,
        assignedRole: "compliance_team",
        dueDateOffsetDays: 3,
        priority: "high",
      })),
    },
  });

  if (params.requiresLegalReview) {
    steps.push({
      id: `step_${++idx}_legal`,
      name: "Legal Review",
      description: "Legal review of updated label copy",
      type: "review",
      assignedRole: "legal_team",
      dependsOn: [steps[1]!.id],
      requiresApproval: true,
      timeoutSeconds: 5 * 86400,
      isCriticalPath: true,
      estimatedDurationDays: 3,
      parameters: {
        type: "review",
        reviewerRoles: ["legal_team"],
        checklist: [
          { item: "Label copy complies with jurisdiction requirements", required: true },
          { item: "Warning labels meet regulatory specifications", required: true },
          { item: "No misleading claims or statements", required: true },
        ],
        reviewTimeoutSeconds: 5 * 86400,
      },
    });
  }

  if (params.requiresArtworkUpdate) {
    steps.push({
      id: `step_${++idx}_artwork`,
      name: "Artwork Update",
      description: "Update packaging artwork with new label content",
      type: "task_creation",
      assignedRole: "marketing_team",
      dependsOn: [steps[steps.length - 1]!.id],
      requiresApproval: false,
      timeoutSeconds: 5 * 86400,
      isCriticalPath: false,
      estimatedDurationDays: 5,
      parameters: {
        type: "task_creation",
        tasks: [{
          title: "Update packaging artwork",
          description: `Update artwork for ${params.productIds.length} products with new label content: ${params.changeTypes.join(", ")}`,
          assignedRole: "marketing_team",
          dueDateOffsetDays: 5,
          priority: "normal",
        }],
      },
    });
  }

  steps.push({
    id: `step_${++idx}_qa_label`,
    name: "Label Quality Check",
    description: "Verify final labels against regulatory requirements",
    type: "quality_check",
    assignedRole: "quality_team",
    dependsOn: [steps[steps.length - 1]!.id],
    requiresApproval: true,
    timeoutSeconds: 3 * 86400,
    isCriticalPath: true,
    estimatedDurationDays: 2,
    parameters: {
      type: "quality_check",
      productIds: params.productIds,
      checkType: "regulatory_compliance",
      specificationIds: params.jurisdictions.map((j) => `spec_${j}`),
      passCriteria: params.changeTypes.map((ct) => ({
        metric: `${ct} compliance`,
        minValue: 1,
      })),
    },
  });

  steps.push({
    id: `step_${++idx}_erp`,
    name: "ERP Label Update",
    description: "Update product records in ERP with new label data",
    type: "erp_update",
    assignedRole: "production_team",
    dependsOn: [steps[steps.length - 1]!.id],
    requiresApproval: false,
    timeoutSeconds: 86400,
    isCriticalPath: true,
    estimatedDurationDays: 1,
    parameters: {
      type: "erp_update",
      operation: "update_item",
      entityIds: params.productIds,
      updatePayload: { changeTypes: params.changeTypes, jurisdictions: params.jurisdictions },
      syncImmediately: true,
    },
  });

  steps.push({
    id: `step_${++idx}_done`,
    name: "Completion Notification",
    description: "Notify stakeholders that label changes are complete",
    type: "notification",
    assignedRole: "compliance_team",
    dependsOn: [steps[steps.length - 1]!.id],
    requiresApproval: false,
    timeoutSeconds: 3600,
    isCriticalPath: false,
    estimatedDurationDays: 0,
    parameters: {
      type: "notification",
      recipients: [{ role: "compliance_team" }, { role: "marketing_team" }, { role: "executive" }],
      channel: "email",
      priority: "normal",
      templateKey: "workflow.completed",
      templateVariables: {
        workflowType: "Label Change",
        duration: "TBD",
        stepsCompleted: String(steps.length),
        summary: "Label changes completed successfully",
      },
    },
  });

  return steps;
}

/**
 * Build default product withdrawal workflow steps.
 */
function buildProductWithdrawalSteps(params: ProductWithdrawalParams): WorkflowStepDefinition[] {
  const steps: WorkflowStepDefinition[] = [];
  let idx = 0;

  steps.push({
    id: `step_${++idx}_urgent_notify`,
    name: "URGENT: Withdrawal Notification",
    description: `URGENT: Notify all stakeholders of product withdrawal — ${params.reason}`,
    type: "notification",
    assignedRole: "compliance_team",
    dependsOn: [],
    requiresApproval: false,
    timeoutSeconds: 1800, // 30 minutes
    isCriticalPath: true,
    estimatedDurationDays: 0,
    parameters: {
      type: "notification",
      recipients: [{ role: "compliance_team" }, { role: "production_team" }, { role: "executive" }, { role: "legal_team" }],
      channel: "email",
      priority: "urgent",
      templateKey: "product_withdrawal.started",
      templateVariables: {
        productName: params.productIds.join(", "),
        reason: params.reason,
        scope: params.scope,
        deadline: params.withdrawalDeadline,
      },
    },
  });

  steps.push({
    id: `step_${++idx}_ops_tasks`,
    name: "Withdrawal Operations Tasks",
    description: "Create operational tasks for product withdrawal",
    type: "task_creation",
    assignedRole: "production_team",
    dependsOn: [steps[0]!.id],
    requiresApproval: false,
    timeoutSeconds: 3600,
    isCriticalPath: true,
    estimatedDurationDays: 1,
    parameters: {
      type: "task_creation",
      tasks: [
        {
          title: "Initiate product withdrawal from market",
          description: `Withdraw products ${params.productIds.join(", ")} — scope: ${params.scope}. Reason: ${params.reason}`,
          assignedRole: "production_team",
          dueDateOffsetDays: 1,
          priority: "urgent",
        },
        {
          title: "Quarantine remaining inventory",
          description: "Quarantine all remaining inventory of affected products",
          assignedRole: "production_team",
          dueDateOffsetDays: 1,
          priority: "urgent",
        },
      ],
    },
  });

  if (params.requiresCustomerNotification) {
    steps.push({
      id: `step_${++idx}_customer_notify`,
      name: "Customer Notification",
      description: "Notify affected customers of the product withdrawal",
      type: "stakeholder_communication",
      assignedRole: "compliance_team",
      dependsOn: [steps[1]!.id],
      requiresApproval: true,
      timeoutSeconds: 24 * 3600, // 24 hours
      isCriticalPath: true,
      estimatedDurationDays: 1,
      parameters: {
        type: "stakeholder_communication",
        stakeholders: [{ type: "customer", ids: params.productIds }],
        communicationType: "notification",
        templateKey: "product_withdrawal.customer_notification",
        keyMessages: [`Product withdrawal due to ${params.reason}`, "Return instructions", "Replacement options if available"],
      },
    });
  }

  steps.push({
    id: `step_${++idx}_erp_deactivate`,
    name: "ERP Product Deactivation",
    description: "Deactivate products in the ERP system",
    type: "erp_update",
    assignedRole: "production_team",
    dependsOn: [steps[steps.length - 1]!.id],
    requiresApproval: false,
    timeoutSeconds: 4 * 3600, // 4 hours
    isCriticalPath: true,
    estimatedDurationDays: 0,
    parameters: {
      type: "erp_update",
      operation: "deactivate_item",
      entityIds: params.productIds,
      updatePayload: { reason: params.reason, scope: params.scope },
      syncImmediately: true,
    },
  });

  steps.push({
    id: `step_${++idx}_review`,
    name: "Post-Withdrawal Review",
    description: "Review the withdrawal process and document lessons learned",
    type: "review",
    assignedRole: "compliance_team",
    dependsOn: [steps[steps.length - 1]!.id],
    requiresApproval: true,
    timeoutSeconds: 5 * 86400,
    isCriticalPath: false,
    estimatedDurationDays: 3,
    parameters: {
      type: "review",
      reviewerRoles: ["compliance_team", "legal_team"],
      checklist: [
        { item: "All products withdrawn from market", required: true },
        { item: "All customers notified", required: true },
        { item: "Inventory quarantined", required: true },
        { item: "ERP records updated", required: true },
        { item: "Root cause documented", required: false },
      ],
      reviewTimeoutSeconds: 5 * 86400,
    },
  });

  return steps;
}

/**
 * Build default compliance review workflow steps.
 */
function buildComplianceReviewSteps(params: ComplianceReviewParams): WorkflowStepDefinition[] {
  const steps: WorkflowStepDefinition[] = [];
  let idx = 0;

  steps.push({
    id: `step_${++idx}_notify`,
    name: "Compliance Review Notification",
    description: `Notify compliance team of new regulations requiring review: ${params.regulationIds.join(", ")}`,
    type: "notification",
    assignedRole: "compliance_team",
    dependsOn: [],
    requiresApproval: false,
    timeoutSeconds: 3600,
    isCriticalPath: false,
    estimatedDurationDays: 0,
    parameters: {
      type: "notification",
      recipients: [{ role: "compliance_team" }, { role: "legal_team" }, { role: "regulatory_affairs" }],
      channel: "email",
      priority: "high",
      templateKey: "compliance_review.started",
      templateVariables: {
        regulationCount: String(params.regulationIds.length),
        productCount: String(params.productIds.length),
        jurisdictions: params.jurisdictions.join(", "),
        deadline: params.reviewDeadline,
      },
    },
  });

  steps.push({
    id: `step_${++idx}_assessment`,
    name: "Product Compliance Assessment",
    description: "Assess each product for compliance with new regulations",
    type: "task_creation",
    assignedRole: "compliance_team",
    dependsOn: [steps[0]!.id],
    requiresApproval: false,
    timeoutSeconds: 3 * 86400,
    isCriticalPath: true,
    estimatedDurationDays: 5,
    parameters: {
      type: "task_creation",
      tasks: params.productIds.map((productId) => ({
        title: `Compliance assessment — Product ${productId}`,
        description: `Assess product ${productId} against regulations: ${params.regulationIds.join(", ")} in jurisdictions: ${params.jurisdictions.join(", ")}`,
        assignedRole: "compliance_team",
        dueDateOffsetDays: 5,
        priority: "high",
      })),
    },
  });

  steps.push({
    id: `step_${++idx}_compliance_review`,
    name: "Compliance Review Gate",
    description: "Review compliance assessment results and determine actions",
    type: "approval",
    assignedRole: "compliance_team",
    dependsOn: [steps[1]!.id],
    requiresApproval: true,
    timeoutSeconds: 5 * 86400,
    isCriticalPath: true,
    estimatedDurationDays: 3,
    parameters: {
      type: "approval",
      approverRoles: ["compliance_team"],
      approvalTimeoutSeconds: 5 * 86400,
      onTimeoutAction: "escalate",
      escalationChain: [{ role: "executive", timeoutSeconds: 2 * 86400 }],
    },
  });

  if (params.requiresExternalCounsel) {
    steps.push({
      id: `step_${++idx}_legal`,
      name: "External Legal Review",
      description: "External legal counsel review of compliance assessment",
      type: "review",
      assignedRole: "legal_team",
      dependsOn: [steps[2]!.id],
      requiresApproval: true,
      timeoutSeconds: 10 * 86400,
      isCriticalPath: true,
      estimatedDurationDays: 7,
      parameters: {
        type: "review",
        reviewerRoles: ["legal_team"],
        checklist: [
          { item: "Regulatory interpretation is correct", required: true },
          { item: "Compliance requirements are fully identified", required: true },
          { item: "Risk assessment is comprehensive", required: true },
        ],
        reviewTimeoutSeconds: 10 * 86400,
      },
    });
  }

  if (params.requiresPreMarketNotification) {
    steps.push({
      id: `step_${++idx}_filing`,
      name: "Pre-Market Notification Filing",
      description: "File pre-market notifications with relevant regulatory bodies",
      type: "regulatory_filing",
      assignedRole: "regulatory_affairs",
      dependsOn: [steps[steps.length - 1]!.id],
      requiresApproval: true,
      timeoutSeconds: 15 * 86400,
      isCriticalPath: true,
      estimatedDurationDays: 10,
      parameters: {
        type: "regulatory_filing",
        jurisdiction: params.jurisdictions.join(", "),
        filingType: "pre_market_approval",
        productIds: params.productIds,
        requiredDocuments: ["compliance_assessment", "safety_data", "product_specifications"],
        deadlineDate: params.reviewDeadline,
      },
    });
  }

  steps.push({
    id: `step_${++idx}_stakeholder`,
    name: "Stakeholder Communication",
    description: "Communicate compliance status to relevant stakeholders",
    type: "stakeholder_communication",
    assignedRole: "compliance_team",
    dependsOn: [steps[steps.length - 1]!.id],
    requiresApproval: false,
    timeoutSeconds: 3 * 86400,
    isCriticalPath: false,
    estimatedDurationDays: 2,
    parameters: {
      type: "stakeholder_communication",
      stakeholders: [
        { type: "regulatory_body", ids: params.jurisdictions.map((j) => `reg_${j}`) },
        { type: "internal_team", ids: ["compliance", "legal", "rd"] },
      ],
      communicationType: "report",
      templateKey: "compliance_review.started",
      keyMessages: ["Compliance assessment complete", "Action items identified", "Remediation timelines"],
    },
  });

  return steps;
}

// ============================================================================
// Override Application
// ============================================================================

/**
 * Apply step overrides from the workflow generator agent.
 * Overrides can skip steps, modify step parameters, or add new dependencies.
 */
function applyStepOverrides(
  steps: WorkflowStepDefinition[],
  overrides: StepOverride[]
): WorkflowStepDefinition[] {
  const overrideMap = new Map(overrides.map((o) => [o.stepId, o]));

  return steps
    .filter((step) => {
      const override = overrideMap.get(step.id);
      // Skip steps that are marked for skipping
      return !override || override.action !== "skip";
    })
    .map((step) => {
      const override = overrideMap.get(step.id);
      if (!override) return step;

      let modified = { ...step };

      // Apply modifications
      if (override.action === "modify" && override.modifications) {
        modified = { ...modified, ...override.modifications };
      }

      // Add new dependency
      if (override.action === "add_dependency" && override.newDependency) {
        modified = {
          ...modified,
          dependsOn: [...modified.dependsOn, override.newDependency],
        };
      }

      return modified;
    });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the Temporal workflow ID for a database workflow instance.
 */
async function getTemporalId(
  tenantId: string,
  workflowInstanceId: string
): Promise<string | null> {
  return withTenant(tenantId, async () => {
    const instance = await prisma.workflowInstance.findUnique({
      where: { id: workflowInstanceId },
      select: { temporalWorkflowId: true },
    });
    return instance?.temporalWorkflowId ?? null;
  });
}

/**
 * Check if a workflow is already running for a given trigger and type.
 * Prevents duplicate workflows for the same regulatory event.
 */
async function isWorkflowRunningForTrigger(
  tenantId: string,
  triggerId: string,
  workflowType: string
): Promise<boolean> {
  return withTenant(tenantId, async () => {
    const existing = await prisma.workflowInstance.findFirst({
      where: {
        tenantId,
        workflowType,
        status: { in: ["PENDING", "RUNNING", "AWAITING_APPROVAL"] },
      },
    });

    if (!existing) return false;

    // Also check Temporal
    if (existing.temporalWorkflowId) {
      return isWorkflowRunning(existing.temporalWorkflowId);
    }

    return existing.status === "PENDING" || existing.status === "RUNNING";
  });
}

/**
 * Generate a unique workflow instance ID.
 * Format: {type_prefix}_{timestamp}_{random}
 */
function generateWorkflowInstanceId(workflowType: CascadaWorkflowType): string {
  const prefix = TEMPORAL_CONFIG.WORKFLOW_ID_PREFIXES[workflowType];
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Get the workflow function reference for a given type.
 * Temporal uses the function reference to identify which workflow to run.
 */
function getWorkflowFunction(
  workflowType: CascadaWorkflowType
): typeof reformulationWorkflow | typeof labelChangeWorkflow | typeof productWithdrawalWorkflow | typeof complianceReviewWorkflow {
  switch (workflowType) {
    case "reformulation":
      return reformulationWorkflow;
    case "label_change":
      return labelChangeWorkflow;
    case "product_withdrawal":
      return productWithdrawalWorkflow;
    case "compliance_review":
      return complianceReviewWorkflow;
  }
}
