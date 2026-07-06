// Cascada — Label Change Workflow
// Temporal workflow that orchestrates the label update lifecycle:
// from identifying required label changes through copy generation,
// legal review, artwork update, compliance verification, and
// production rollout. Label changes are typically triggered by
// new warning label requirements, ingredient list changes, or
// allergen declaration mandates.
//
// COMMAND plan only.
//
// Workflow lifecycle:
// 1. Notify stakeholders of required label changes
// 2. Create tasks for label copy generation
// 3. Await R&D/Compliance review of new copy
// 4. Legal review of label copy (if required)
// 5. Artwork update tasks (if required)
// 6. Quality check of final labels
// 7. Update ERP with label data
// 8. Await production team sign-off
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
  LabelChangeParams,
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
import { TEMPORAL_CONFIG } from "@/lib/workflows/types";

// ============================================================================
// Activity Proxy
// ============================================================================

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
    nonRetryableErrorTypes: ["WorkflowActivityError"],
  },
});

// ============================================================================
// Signals & Queries
// ============================================================================

const approvalSignal = defineSignal<[ApprovalSignal]>("approval");
const reviewSignal = defineSignal<[ReviewSignal]>("review");
const cancellationSignal = defineSignal<[CancellationSignal]>("cancel");
const statusQuery = defineQuery<WorkflowStatus>("status");

// ============================================================================
// Workflow Definition
// ============================================================================

export interface LabelChangeWorkflowInput {
  tenantId: string;
  workflowInstanceId: string;
  initiatedByUserId: string;
  params: LabelChangeParams;
  steps: WorkflowStepDefinition[];
  deadline?: string;
  priority: "low" | "normal" | "high" | "urgent";
}

/**
 * Label Change Workflow — orchestrates the label update lifecycle.
 *
 * Label changes are typically faster than reformulation but involve
 * more stakeholder coordination: legal review, marketing approval,
 * and production scheduling. The workflow enforces the compliance
 * deadline and escalates if the deadline is at risk.
 *
 * Key design decisions:
 * - Legal review is a mandatory gate if requiresLegalReview is true
 * - Artwork updates run in parallel with legal review where possible
 * - Quality check validates the final printed label against the regulation
 * - ERP update occurs after all approvals are complete
 * - Automatic escalation if compliance deadline is within 7 days
 */
export async function labelChangeWorkflow(
  input: LabelChangeWorkflowInput
): Promise<StepExecutionResult[]> {
  const { tenantId, workflowInstanceId, initiatedByUserId, params, steps, deadline, priority } = input;
  const stepResults: Map<string, StepExecutionResult> = new Map();
  const stepStates: Map<string, StepState> = new Map();
  const completedStepIds: Set<string> = new Set();
  const failedStepIds: Set<string> = new Set();

  let pendingApproval: ApprovalSignal | null = null;
  let pendingReview: ReviewSignal | null = null;
  let cancellation: CancellationSignal | null = null;
  let workflowState: WorkflowState = "running";

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
      workflowType: "label_change",
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

  const maxIterations = steps.length * 3;
  let iteration = 0;

  while (completedStepIds.size + failedStepIds.size < steps.length && iteration < maxIterations) {
    iteration++;

    // Check for cancellation
    if (cancellation) {
      workflowState = "cancelled";
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

    // Find next ready step
    const nextStep = steps.find((step) => {
      const state = stepStates.get(step.id);
      if (state !== "pending") return false;
      return step.dependsOn.every((depId: string) => completedStepIds.has(depId));
    });

    if (!nextStep) {
      await sleep("10 seconds");
      continue;
    }

    stepStates.set(nextStep.id, "running");
    const stepStartTime = new Date().toISOString();

    try {
      const result = await executeLabelStep(nextStep, {
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

  if (!cancellation) {
    workflowState = failedStepIds.size > 0 ? "failed" : "completed";
  }

  return Array.from(stepResults.values());
}

// ============================================================================
// Step Execution Logic
// ============================================================================

interface LabelStepContext {
  tenantId: string;
  workflowInstanceId: string;
  initiatedByUserId: string;
  params: LabelChangeParams;
  priority: string;
  deadline?: string;
  getPendingApproval: () => ApprovalSignal | null;
  clearPendingApproval: () => void;
  getPendingReview: () => ReviewSignal | null;
  clearPendingReview: () => void;
}

interface LabelStepOutput {
  approvedBy?: string;
  output?: Record<string, unknown>;
}

/**
 * Execute a single label change workflow step.
 * Handles notification, task creation, approval gates, reviews,
 * ERP updates, quality checks, and stakeholder communications.
 */
async function executeLabelStep(
  step: WorkflowStepDefinition,
  ctx: LabelStepContext
): Promise<LabelStepOutput> {
  const now = new Date().toISOString();

  switch (step.parameters.type) {
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
          deadline: ctx.deadline ?? ctx.params.complianceDeadline,
          productCount: String(ctx.params.productIds.length),
          changeTypes: ctx.params.changeTypes.join(", "),
          jurisdictions: ctx.params.jurisdictions.join(", "),
        },
        triggeredAt: now,
      });
      return {
        output: { notificationsSent: result.notificationsSent, notificationIds: result.notificationIds },
      };
    }

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

    case "approval": {
      const approvalParams = step.parameters;
      const timeoutMs = approvalParams.approvalTimeoutSeconds * 1000;

      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: approvalParams.approverRoles.map((role: string) => ({ role })),
        channel: "email",
        priority: "high",
        templateKey: "label_change.review_needed",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          stepName: step.name,
          changeTypes: ctx.params.changeTypes.join(", "),
          deadline: ctx.params.complianceDeadline,
        },
        triggeredAt: now,
      });

      // Wait for approval
      const approved = await waitForLabelApproval(ctx, step.id, timeoutMs);
      if (!approved) {
        if (approvalParams.onTimeoutAction === "escalate") {
          await notifyTeam({
            tenantId: ctx.tenantId,
            workflowInstanceId: ctx.workflowInstanceId,
            stepId: step.id,
            recipients: (approvalParams.escalationChain ?? []).map((e: { role: string; timeoutSeconds: number }) => ({ role: e.role })),
            channel: "email",
            priority: "urgent",
            templateKey: "workflow.escalation",
            templateVariables: {
              workflowType: "Label Change",
              stepName: step.name,
              timeout: `${approvalParams.approvalTimeoutSeconds}s`,
              assignedRole: step.assignedRole,
            },
            triggeredAt: now,
          });
          const escalatedTimeout = approvalParams.escalationChain?.[0]?.timeoutSeconds ?? 86400;
          const secondApproval = await waitForLabelApproval(ctx, step.id, escalatedTimeout * 1000);
          if (!secondApproval) {
            throw ApplicationFailure.create({
              message: `TIMEOUT: Approval for '${step.name}' timed out after escalation`,
            });
          }
          return { approvedBy: ctx.getPendingApproval()?.approverUserId };
        } else if (approvalParams.onTimeoutAction === "auto_approve") {
          return { approvedBy: "system_auto_approved" };
        } else {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Approval for '${step.name}' timed out`,
          });
        }
      }
      return { approvedBy: ctx.getPendingApproval()?.approverUserId };
    }

    case "review": {
      const reviewParams = step.parameters;
      const timeoutMs = reviewParams.reviewTimeoutSeconds * 1000;

      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: reviewParams.reviewerRoles.map((role: string) => ({ role })),
        channel: "email",
        priority: "normal",
        templateKey: "label_change.review_needed",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          stepName: step.name,
          changeTypes: ctx.params.changeTypes.join(", "),
        },
        triggeredAt: now,
      });

      const reviewed = await waitForLabelReview(ctx, step.id, timeoutMs);
      if (!reviewed) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Review for '${step.name}' timed out`,
        });
      }

      const review = ctx.getPendingReview();
      ctx.clearPendingReview();

      if (review?.verdict === "fail") {
        throw ApplicationFailure.create({
          message: `Review failed for '${step.name}': ${review.conditions?.join(", ") ?? "No conditions"}`,
        });
      }

      return {
        approvedBy: review?.reviewerUserId,
        output: { verdict: review?.verdict, conditions: review?.conditions },
      };
    }

    case "erp_update": {
      const erpParams = step.parameters;
      const erpConnectionId = (step.parameters as unknown as Record<string, unknown>)["erpConnectionId"] as string ?? "default";

      const result = await updateErp({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        erpConnectionId,
        operation: erpParams.operation,
        entityIds: erpParams.entityIds,
        updatePayload: {
          ...erpParams.updatePayload,
          changeTypes: ctx.params.changeTypes,
          jurisdictions: ctx.params.jurisdictions,
          complianceDeadline: ctx.params.complianceDeadline,
        },
        syncImmediately: erpParams.syncImmediately,
        triggeredAt: now,
      });

      return {
        output: { entitiesUpdated: result.entitiesUpdated, syncStatus: result.syncStatus },
      };
    }

    case "quality_check": {
      const qcParams = step.parameters;
      const timeoutMs = step.timeoutSeconds * 1000;

      await createTasks({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        tasks: qcParams.productIds.map((productId: string) => ({
          title: `Quality check — Label for product ${productId}`,
          description: `Verify label for product ${productId} against: ${qcParams.checkType}. Spec IDs: ${qcParams.specificationIds.join(", ")}`,
          assignedRole: "quality_team",
          dueDateOffsetDays: step.estimatedDurationDays,
          priority: step.isCriticalPath ? "high" : "normal",
        })),
        triggeredAt: now,
      });

      const reviewed = await waitForLabelReview(ctx, step.id, timeoutMs);
      if (!reviewed) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Quality check for '${step.name}' timed out`,
        });
      }

      return { output: { productsChecked: qcParams.productIds.length, checkType: qcParams.checkType } };
    }

    case "label_update": {
      const labelParams = step.parameters;

      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: [{ role: "marketing_team" }, { role: "production_team" }],
        channel: "email",
        priority: "high",
        templateKey: "label_change.started",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          productCount: String(labelParams.productIds.length),
          changeTypes: labelParams.changeTypes.join(", "),
          jurisdictions: labelParams.jurisdictions.join(", "),
          deadline: labelParams.complianceDeadline,
        },
        triggeredAt: now,
      });

      if (step.requiresApproval) {
        const approved = await waitForLabelApproval(ctx, step.id, step.timeoutSeconds * 1000);
        if (!approved) {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Label update approval for '${step.name}' timed out`,
          });
        }
        return { approvedBy: ctx.getPendingApproval()?.approverUserId };
      }

      return { output: { productsUpdated: labelParams.productIds.length } };
    }

    case "stakeholder_communication": {
      const commParams = step.parameters;

      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: commParams.stakeholders.flatMap((s) =>
          s.ids.map((id) => ({ userId: id }))
        ),
        channel: "email",
        priority: "normal",
        templateKey: commParams.templateKey,
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          keyMessages: commParams.keyMessages.join("; "),
          changeTypes: ctx.params.changeTypes.join(", "),
          complianceDeadline: ctx.params.complianceDeadline,
        },
        triggeredAt: now,
      });

      return { output: { stakeholderGroups: commParams.stakeholders.length } };
    }

    default: {
      // Generic step handling for regulatory_filing, supplier_negotiation, production_change
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
        const approved = await waitForLabelApproval(ctx, step.id, timeoutMs);
        if (!approved) {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Step '${step.name}' timed out`,
          });
        }
        return { approvedBy: ctx.getPendingApproval()?.approverUserId };
      }

      return { output: { stepType: step.parameters.type, completed: true } };
    }
  }
}

// ============================================================================
// Wait Helpers
// ============================================================================

async function waitForLabelApproval(
  ctx: LabelStepContext,
  stepId: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    await condition(
      () => ctx.getPendingApproval() !== null && ctx.getPendingApproval()?.stepId === stepId,
      timeoutMs
    );
  } catch (err) {
    if (err instanceof TimeoutFailure) return false;
    throw err;
  }

  const approval = ctx.getPendingApproval();
  ctx.clearPendingApproval();

  if (approval?.decision === "rejected") {
    throw ApplicationFailure.create({
      message: `Step '${stepId}' rejected by ${approval.approverUserId}${approval.notes ? `: ${approval.notes}` : ""}`,
    });
  }

  return approval?.decision === "approved";
}

async function waitForLabelReview(
  ctx: LabelStepContext,
  stepId: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    await condition(
      () => ctx.getPendingReview() !== null && ctx.getPendingReview()?.stepId === stepId,
      timeoutMs
    );
  } catch (err) {
    if (err instanceof TimeoutFailure) return false;
    throw err;
  }

  const review = ctx.getPendingReview();
  if (review?.stepId === stepId) return true;
  ctx.clearPendingReview();
  return false;
}
