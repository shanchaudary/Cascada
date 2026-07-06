// Cascada — Reformulation Workflow
// Temporal workflow that orchestrates the full reformulation lifecycle:
// from ingredient identification and substitution through testing,
// approval, ERP update, and production cutover. This is the most
// complex workflow in Cascada because reformulation touches every
// part of the product lifecycle — R&D, procurement, quality, production,
// and regulatory affairs.
//
// COMMAND plan only — requires full platform tier.
//
// Workflow lifecycle:
// 1. Notify stakeholders that reformulation is starting
// 2. Create R&D tasks for substitute evaluation
// 3. Await R&D review and approval of substitute
// 4. Run sensory and stability testing (if required)
// 5. Await quality approval of test results
// 6. Update ERP with new BOM/formulation
// 7. Await production team approval for cutover
// 8. Execute production change
// 9. Notify stakeholders of completion

import {
  proxyActivities,
  defineQuery,
  defineSignal,
  setHandler,
  condition,
  sleep,
  workflowInfo,
  TimeoutFailure,
  ApplicationFailure,
} from "@temporalio/workflow";
import type {
  ReformulationParams,
  WorkflowStepDefinition,
  StepExecutionResult,
  StepState,
  ApprovalSignal,
  ReviewSignal,
  CancellationSignal,
  WorkflowStatus,
  WorkflowState,
  NotifyTeamInput,
  NotifyTeamOutput,
  CreateTasksInput,
  CreateTasksOutput,
  UpdateErpInput,
  UpdateErpOutput,
} from "@/lib/workflows/types";
import { TEMPORAL_CONFIG, WORKFLOW_TRANSITIONS } from "@/lib/workflows/types";

// ============================================================================
// Activity Proxy (type-safe)
// ============================================================================

/**
 * Type-safe proxy for Temporal activities.
 * The activities run on the worker and perform the actual work.
 * Retries are configured with exponential backoff.
 */
const { notifyTeam, createTasks, updateErp } = proxyActivities<{
  notifyTeam(input: NotifyTeamInput): Promise<NotifyTeamOutput>;
  createTasks(input: CreateTasksInput): Promise<CreateTasksOutput>;
  updateErp(input: UpdateErpInput): Promise<UpdateErpOutput>;
}>({
  startToCloseTimeout: "5 minutes",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: TEMPORAL_CONFIG.MAX_ACTIVITY_RETRIES,
    nonRetryableErrorTypes: [
      "WorkflowActivityError",
    ],
  },
});

// ============================================================================
// Signals & Queries
// ============================================================================

/** Signal for approving or rejecting a step */
const approvalSignal = defineSignal<[ApprovalSignal]>("approval");
/** Signal for completing a review */
const reviewSignal = defineSignal<[ReviewSignal]>("review");
/** Signal for cancelling the workflow */
const cancellationSignal = defineSignal<[CancellationSignal]>("cancel");
/** Query for current workflow status */
const statusQuery = defineQuery<WorkflowStatus>("status");

// ============================================================================
// Workflow Definition
// ============================================================================

/**
 * Input for the reformulation workflow.
 * Passed when starting the workflow from the orchestrator.
 */
export interface ReformulationWorkflowInput {
  tenantId: string;
  workflowInstanceId: string;
  initiatedByUserId: string;
  params: ReformulationParams;
  steps: WorkflowStepDefinition[];
  deadline?: string;
  priority: "low" | "normal" | "high" | "urgent";
}

/**
 * Reformulation Workflow — orchestrates the full reformulation lifecycle.
 *
 * This is a long-running durable workflow that can take days or weeks
 * to complete. It uses Temporal's durable execution to survive
 * process restarts, server failures, and long waits for human approval.
 *
 * Key design decisions:
 * - Steps are executed in dependency order (topological sort)
 * - Approval steps block until a signal is received or timeout
 * - Failed steps can be retried by sending another approval signal
 * - The workflow can be cancelled at any point via signal
 * - Each step's result is tracked and queryable
 */
export async function reformulationWorkflow(
  input: ReformulationWorkflowInput
): Promise<StepExecutionResult[]> {
  // ========================================================================
  // State Initialization
  // ========================================================================

  const { tenantId, workflowInstanceId, initiatedByUserId, params, steps, deadline, priority } = input;
  const stepResults: Map<string, StepExecutionResult> = new Map();
  const stepStates: Map<string, StepState> = new Map();
  const completedStepIds: Set<string> = new Set();
  const failedStepIds: Set<string> = new Set();

  // Pending approvals and reviews — populated by signal handlers
  let pendingApproval: ApprovalSignal | null = null;
  let pendingReview: ReviewSignal | null = null;
  let cancellation: CancellationSignal | null = null;
  let workflowState: WorkflowState = "running";

  // Initialize all steps as pending
  for (const step of steps) {
    stepStates.set(step.id, "pending");
  }

  // ========================================================================
  // Signal & Query Handlers
  // ========================================================================

  setHandler(approvalSignal, (signal: ApprovalSignal) => {
    pendingApproval = signal;
  });

  setHandler(reviewSignal, (signal: ReviewSignal) => {
    pendingReview = signal;
  });

  setHandler(cancellationSignal, (signal: CancellationSignal) => {
    cancellation = signal;
    workflowState = "cancelled";
  });

  setHandler(statusQuery, (): WorkflowStatus => {
    const currentStep = steps.find(
      (s) => stepStates.get(s.id) === "running" || stepStates.get(s.id) === "pending"
    );
    return {
      workflowType: "reformulation",
      state: workflowState,
      currentStepId: currentStep?.id ?? null,
      currentStepName: currentStep?.name ?? null,
      completedStepIds: Array.from(completedStepIds),
      pendingStepIds: steps
        .filter((s) => stepStates.get(s.id) === "pending")
        .map((s) => s.id),
      totalSteps: steps.length,
      progressPercent: Math.round((completedStepIds.size / steps.length) * 100),
      startedAt: workflowInfo().startTime?.toISOString() ?? new Date().toISOString(),
      awaitingActionFrom: steps
        .filter((s) => stepStates.get(s.id) === "running" && s.requiresApproval)
        .map((s) => ({
          stepId: s.id,
          stepName: s.name,
          assignedRole: s.assignedRole,
        })),
    };
  });

  // ========================================================================
  // Step Execution Engine
  // ========================================================================

  /**
   * Execute steps in dependency order. Steps with unmet dependencies
   * are skipped until their dependencies complete. The engine runs
   * until all steps are completed, failed, or the workflow is cancelled.
   */
  const maxIterations = steps.length * 3; // Safety limit
  let iteration = 0;

  while (completedStepIds.size + failedStepIds.size < steps.length && iteration < maxIterations) {
    iteration++;

    // Check for cancellation
    if (cancellation) {
      workflowState = "cancelled";
      // Mark all remaining steps as skipped
      for (const step of steps) {
        if (stepStates.get(step.id) !== "completed") {
          stepStates.set(step.id, "skipped");
          stepResults.set(step.id, {
            stepId: step.id,
            stepName: step.name,
            state: "skipped",
            startedAt: new Date().toISOString(),
            error: `Workflow cancelled: ${(cancellation as CancellationSignal).reason}`,
            retryCount: 0,
          });
        }
      }
      break;
    }

    // Find the next step that is ready to execute
    const nextStep = steps.find((step) => {
      const state = stepStates.get(step.id);
      if (state !== "pending") return false;
      // Check all dependencies are completed
      return step.dependsOn.every((depId: string) => completedStepIds.has(depId));
    });

    if (!nextStep) {
      // No step is ready — either we're waiting for a running step
      // or all remaining steps have unmet dependencies
      // Wait a bit and check again
      await sleep("10 seconds");
      continue;
    }

    // Execute the step
    stepStates.set(nextStep.id, "running");
    const stepStartTime = new Date().toISOString();

    try {
      const result = await executeStep(nextStep, {
        tenantId,
        workflowInstanceId,
        initiatedByUserId,
        params,
        priority,
        deadline,
        getPendingApproval: () => pendingApproval,
        clearPendingApproval: () => { pendingApproval = null; },
        getPendingReview: () => pendingReview,
        clearPendingReview: () => { pendingReview = null; },
      });

      stepStates.set(nextStep.id, "completed");
      completedStepIds.add(nextStep.id);
      stepResults.set(nextStep.id, {
        stepId: nextStep.id,
        stepName: nextStep.name,
        state: "completed",
        approvedBy: result.approvedBy,
        startedAt: stepStartTime,
        completedAt: new Date().toISOString(),
        durationSeconds: Math.round((Date.now() - new Date(stepStartTime).getTime()) / 1000),
        output: result.output,
        retryCount: 0,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("TIMEOUT")) {
        stepStates.set(nextStep.id, "failed");
        failedStepIds.add(nextStep.id);
        stepResults.set(nextStep.id, {
          stepId: nextStep.id,
          stepName: nextStep.name,
          state: "failed",
          startedAt: stepStartTime,
          error: errorMessage,
          retryCount: 0,
        });
      } else {
        stepStates.set(nextStep.id, "failed");
        failedStepIds.add(nextStep.id);
        stepResults.set(nextStep.id, {
          stepId: nextStep.id,
          stepName: nextStep.name,
          state: "failed",
          startedAt: stepStartTime,
          error: errorMessage,
          retryCount: 0,
        });
      }
    }
  }

  // Set final workflow state
  if (!cancellation) {
    workflowState = failedStepIds.size > 0 ? "failed" : "completed";
  }

  return Array.from(stepResults.values());
}

// ============================================================================
// Step Execution Logic
// ============================================================================

interface StepExecutionContext {
  tenantId: string;
  workflowInstanceId: string;
  initiatedByUserId: string;
  params: ReformulationParams;
  priority: string;
  deadline?: string;
  getPendingApproval: () => ApprovalSignal | null;
  clearPendingApproval: () => void;
  getPendingReview: () => ReviewSignal | null;
  clearPendingReview: () => void;
}

interface StepExecutionOutput {
  approvedBy?: string;
  output?: Record<string, unknown>;
}

/**
 * Execute a single workflow step by dispatching to the appropriate
 * activity based on the step type. For approval and review steps,
 * blocks until a signal is received or a timeout occurs.
 */
async function executeStep(
  step: WorkflowStepDefinition,
  ctx: StepExecutionContext
): Promise<StepExecutionOutput> {
  const now = new Date().toISOString();

  switch (step.parameters.type) {
    // ======================================================================
    // Notification Step
    // ======================================================================
    case "notification": {
      const notifyParams = step.parameters;
      const result = await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: notifyParams.recipients,
        channel: notifyParams.channel,
        priority: notifyParams.priority,
        templateKey: notifyParams.templateKey,
        templateVariables: {
          ...notifyParams.templateVariables,
          workflowId: ctx.workflowInstanceId,
          priority: ctx.priority,
          deadline: ctx.deadline ?? "TBD",
        },
        triggeredAt: now,
      });
      return {
        output: { notificationsSent: result.notificationsSent, notificationIds: result.notificationIds },
      };
    }

    // ======================================================================
    // Task Creation Step
    // ======================================================================
    case "task_creation": {
      const taskParams = step.parameters;
      const result = await createTasks({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        tasks: taskParams.tasks.map((t) => ({
          ...t,
          dueDateOffsetDays: t.dueDateOffsetDays,
        })) as CreateTasksInput["tasks"],
        triggeredAt: now,
      });
      return {
        output: { tasksCreated: result.tasksCreated, taskIds: result.taskIds },
      };
    }

    // ======================================================================
    // Approval Step — blocks until signal received or timeout
    // ======================================================================
    case "approval": {
      const approvalParams = step.parameters;
      const timeoutMs = approvalParams.approvalTimeoutSeconds * 1000;

      // Send notification requesting approval
      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: approvalParams.approverRoles.map((role: string) => ({ role })),
        channel: "email",
        priority: "high",
        templateKey: "reformulation.approval_needed",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          stepName: step.name,
          ingredients: ctx.params.targetIngredientIds.join(", "),
          deadline: ctx.params.complianceDate,
        },
        triggeredAt: now,
      });

      // Wait for approval signal or timeout
      const approved = await waitForApproval(ctx, step.id, timeoutMs);

      if (!approved) {
        // Handle timeout based on configured action
        if (approvalParams.onTimeoutAction === "escalate") {
          // Escalate to next level
          await notifyTeam({
            tenantId: ctx.tenantId,
            workflowInstanceId: ctx.workflowInstanceId,
            stepId: step.id,
            recipients: (approvalParams.escalationChain ?? []).map((e: { role: string; timeoutSeconds: number }) => ({ role: e.role })),
            channel: "email",
            priority: "urgent",
            templateKey: "workflow.escalation",
            templateVariables: {
              workflowType: "Reformulation",
              stepName: step.name,
              timeout: `${approvalParams.approvalTimeoutSeconds}s`,
              assignedRole: step.assignedRole,
            },
            triggeredAt: now,
          });
          // Wait again with escalated timeout
          const escalatedTimeout = approvalParams.escalationChain?.[0]?.timeoutSeconds ?? 86400;
          const secondApproval = await waitForApproval(ctx, step.id, escalatedTimeout * 1000);
          if (!secondApproval) {
            throw ApplicationFailure.create({
              message: `TIMEOUT: Approval step '${step.name}' timed out after escalation`,
            });
          }
          return { approvedBy: ctx.getPendingApproval()?.approverUserId };
        } else if (approvalParams.onTimeoutAction === "auto_approve") {
          return { approvedBy: "system_auto_approved" };
        } else if (approvalParams.onTimeoutAction === "cancel_workflow") {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Approval step '${step.name}' timed out — workflow cancelled`,
          });
        } else {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Approval step '${step.name}' timed out`,
          });
        }
      }

      return { approvedBy: ctx.getPendingApproval()?.approverUserId };
    }

    // ======================================================================
    // Review Step — blocks until review signal or timeout
    // ======================================================================
    case "review": {
      const reviewParams = step.parameters;
      const timeoutMs = reviewParams.reviewTimeoutSeconds * 1000;

      // Notify reviewers
      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: reviewParams.reviewerRoles.map((role: string) => ({ role })),
        channel: "email",
        priority: "normal",
        templateKey: "reformulation.testing_complete",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          stepName: step.name,
        },
        triggeredAt: now,
      });

      // Wait for review signal or timeout
      const reviewed = await waitForReview(ctx, step.id, timeoutMs);

      if (!reviewed) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Review step '${step.name}' timed out`,
        });
      }

      const review = ctx.getPendingReview();
      ctx.clearPendingReview();

      if (review?.verdict === "fail") {
        throw ApplicationFailure.create({
          message: `Review failed for step '${step.name}': ${review.conditions?.join(", ") ?? "No conditions specified"}`,
        });
      }

      return {
        approvedBy: review?.reviewerUserId,
        output: { verdict: review?.verdict, conditions: review?.conditions },
      };
    }

    // ======================================================================
    // ERP Update Step
    // ======================================================================
    case "erp_update": {
      const erpParams = step.parameters;

      // Find the active ERP connection for this tenant
      // In production, this queries the database. For now, we pass it via parameters.
      const erpConnectionId = (step.parameters as unknown as Record<string, unknown>)["erpConnectionId"] as string ?? "default";

      const result = await updateErp({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        erpConnectionId,
        operation: erpParams.operation,
        entityIds: erpParams.entityIds,
        updatePayload: erpParams.updatePayload,
        syncImmediately: erpParams.syncImmediately,
        triggeredAt: now,
      });

      return {
        output: {
          entitiesUpdated: result.entitiesUpdated,
          syncStatus: result.syncStatus,
        },
      };
    }

    // ======================================================================
    // Testing Step — creates tasks and waits for completion
    // ======================================================================
    case "testing": {
      const testingParams = step.parameters;
      const timeoutMs = testingParams.estimatedDurationDays * 24 * 60 * 60 * 1000;

      // Create testing tasks
      await createTasks({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        tasks: testingParams.productIds.map((productId: string, idx: number) => ({
          title: `${testingParams.testingType} testing — Product ${idx + 1}`,
          description: `Conduct ${testingParams.testingType} testing for product ${productId}${testingParams.protocol ? ` following protocol: ${testingParams.protocol}` : ""}`,
          assignedRole: "quality_team",
          dueDateOffsetDays: testingParams.estimatedDurationDays,
          priority: step.isCriticalPath ? "high" : "normal",
        })),
        triggeredAt: now,
      });

      // Wait for review/approval of test results
      const reviewResult = await waitForReview(ctx, step.id, timeoutMs);

      if (!reviewResult) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Testing step '${step.name}' timed out`,
        });
      }

      return {
        output: {
          testingType: testingParams.testingType,
          productsTested: testingParams.productIds.length,
        },
      };
    }

    // ======================================================================
    // Supplier Negotiation Step
    // ======================================================================
    case "supplier_negotiation": {
      const supplierParams = step.parameters;
      const timeoutMs = supplierParams.maxDurationDays * 24 * 60 * 60 * 1000;

      // Create negotiation tasks for procurement
      await createTasks({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        tasks: supplierParams.supplierIds.map((supplierId) => ({
          title: `Negotiate with supplier ${supplierId}`,
          description: `Negotiate: ${supplierParams.objectives.map((o) => o.description).join("; ")}`,
          assignedRole: "procurement_team",
          dueDateOffsetDays: supplierParams.maxDurationDays,
          priority: "high",
        })),
        triggeredAt: now,
      });

      // Wait for approval of negotiation results
      const approved = await waitForApproval(ctx, step.id, timeoutMs);

      if (!approved) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Supplier negotiation step '${step.name}' timed out`,
        });
      }

      return {
        approvedBy: ctx.getPendingApproval()?.approverUserId,
      };
    }

    // ======================================================================
    // Production Change Step
    // ======================================================================
    case "production_change": {
      const productionParams = step.parameters;

      // Notify production team
      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: [{ role: "production_team" }],
        channel: "email",
        priority: "urgent",
        templateKey: "workflow.completed",
        templateVariables: {
          workflowType: "Reformulation",
          stepName: step.name,
          products: productionParams.productIds.join(", "),
          cutoverDate: productionParams.cutoverDate ?? "TBD",
        },
        triggeredAt: now,
      });

      // Update ERP with formulation changes
      for (const change of productionParams.formulationChanges) {
        await updateErp({
          tenantId: ctx.tenantId,
          workflowInstanceId: ctx.workflowInstanceId,
          stepId: step.id,
          erpConnectionId: (step.parameters as unknown as Record<string, unknown>)["erpConnectionId"] as string ?? "default",
          operation: "update_bom",
          entityIds: [change.formulationId],
          updatePayload: {
            changeType: change.changeType,
            details: change.details,
            effectiveDate: productionParams.cutoverDate,
          },
          syncImmediately: true,
          triggeredAt: now,
        });
      }

      return {
        output: {
          formulationsUpdated: productionParams.formulationChanges.length,
          productsAffected: productionParams.productIds.length,
        },
      };
    }

    // ======================================================================
    // Default — quality check, regulatory filing, label update, stakeholder comm
    // ======================================================================
    case "quality_check":
    case "regulatory_filing":
    case "label_update":
    case "stakeholder_communication": {
      // These step types follow the same pattern:
      // 1. Create tasks for the responsible team
      // 2. Wait for approval/review
      const timeoutMs = step.timeoutSeconds * 1000;

      await createTasks({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        tasks: [{
          title: step.name,
          description: step.description,
          assignedRole: step.assignedRole,
          dueDateOffsetDays: step.estimatedDurationDays,
          priority: step.isCriticalPath ? "high" : "normal",
        }],
        triggeredAt: now,
      });

      if (step.requiresApproval) {
        const approved = await waitForApproval(ctx, step.id, timeoutMs);
        if (!approved) {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Step '${step.name}' timed out waiting for approval`,
          });
        }
        return { approvedBy: ctx.getPendingApproval()?.approverUserId };
      }

      return { output: { stepType: step.parameters.type, completed: true } };
    }

    default:
      throw ApplicationFailure.create({
        message: `Unknown step type: ${(step.parameters as { type: string }).type}`,
      });
  }
}

// ============================================================================
// Wait Helpers
// ============================================================================

/**
 * Wait for an approval signal on a specific step.
 * Returns true if approved, false if rejected or timed out.
 * Clears the pending approval after processing.
 */
async function waitForApproval(
  ctx: StepExecutionContext,
  stepId: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    await condition(
      () => ctx.getPendingApproval() !== null && ctx.getPendingApproval()?.stepId === stepId,
      timeoutMs
    );
  } catch (err) {
    if (err instanceof TimeoutFailure) {
      return false; // Timeout
    }
    throw err;
  }

  const approval = ctx.getPendingApproval();
  ctx.clearPendingApproval();

  if (approval?.decision === "rejected") {
    throw ApplicationFailure.create({
      message: `Step '${stepId}' was rejected by ${approval.approverUserId}${approval.notes ? `: ${approval.notes}` : ""}`,
    });
  }

  return approval?.decision === "approved";
}

/**
 * Wait for a review signal on a specific step.
 * Returns true if reviewed, false if timed out.
 * Clears the pending review after processing.
 */
async function waitForReview(
  ctx: StepExecutionContext,
  stepId: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    await condition(
      () => ctx.getPendingReview() !== null && ctx.getPendingReview()?.stepId === stepId,
      timeoutMs
    );
  } catch (err) {
    if (err instanceof TimeoutFailure) {
      return false; // Timeout
    }
    throw err;
  }

  const review = ctx.getPendingReview();
  if (review?.stepId === stepId) {
    // Review was received — don't clear yet, let the step handler read it
    return true;
  }

  ctx.clearPendingReview();
  return false;
}
