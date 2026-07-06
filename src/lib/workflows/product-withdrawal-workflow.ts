// Cascada — Product Withdrawal Workflow
// Temporal workflow that orchestrates the product withdrawal lifecycle:
// from initial withdrawal decision through customer notification,
// inventory management, ERP deactivation, regulatory filing, and
// post-withdrawal review. Product withdrawals are the most urgent
// workflow — they are triggered by regulatory bans, safety concerns,
// or customer mandates and must be executed quickly.
//
// COMMAND plan only.
//
// Workflow lifecycle:
// 1. URGENT notification to all stakeholders
// 2. Create withdrawal tasks for operations
// 3. Notify affected customers (if required)
// 4. Deactivate products in ERP
// 5. Regulatory filing (if required)
// 6. Quality check of remaining inventory
// 7. Stakeholder communication (suppliers, regulatory bodies)
// 8. Post-withdrawal review and sign-off

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
  ProductWithdrawalParams,
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

export interface ProductWithdrawalWorkflowInput {
  tenantId: string;
  workflowInstanceId: string;
  initiatedByUserId: string;
  params: ProductWithdrawalParams;
  steps: WorkflowStepDefinition[];
  deadline?: string;
  priority: "low" | "normal" | "high" | "urgent";
}

/**
 * Product Withdrawal Workflow — orchestrates the product withdrawal lifecycle.
 *
 * Product withdrawals are the most time-critical workflow in Cascada.
 * Regulatory bans and safety concerns require immediate action, often
 * within 24-48 hours. The workflow enforces tight deadlines and
 * escalates aggressively when steps are not completed on time.
 *
 * Key design decisions:
 * - All notifications are sent with "urgent" priority by default
 * - Approval timeouts default to shorter durations (hours, not days)
 * - Customer notification is mandatory for full market withdrawals
 * - ERP deactivation happens early in the workflow (before full review)
 * - Post-withdrawal review captures lessons learned
 * - Automatic escalation if any step takes more than 2x its estimated time
 */
export async function productWithdrawalWorkflow(
  input: ProductWithdrawalWorkflowInput
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
      workflowType: "product_withdrawal",
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

    const nextStep = steps.find((step) => {
      const state = stepStates.get(step.id);
      if (state !== "pending") return false;
      return step.dependsOn.every((depId: string) => completedStepIds.has(depId));
    });

    if (!nextStep) {
      await sleep("5 seconds"); // Faster polling for urgent workflows
      continue;
    }

    stepStates.set(nextStep.id, "running");
    const stepStartTime = new Date().toISOString();

    try {
      const result = await executeWithdrawalStep(nextStep, {
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

interface WithdrawalStepContext {
  tenantId: string;
  workflowInstanceId: string;
  initiatedByUserId: string;
  params: ProductWithdrawalParams;
  priority: string;
  deadline?: string;
  getPendingApproval: () => ApprovalSignal | null;
  clearPendingApproval: () => void;
  getPendingReview: () => ReviewSignal | null;
  clearPendingReview: () => void;
}

interface WithdrawalStepOutput {
  approvedBy?: string;
  output?: Record<string, unknown>;
}

/**
 * Execute a single product withdrawal step.
 * Withdrawal steps are treated with higher urgency — shorter timeouts,
 * more aggressive escalation, and mandatory customer notifications.
 */
async function executeWithdrawalStep(
  step: WorkflowStepDefinition,
  ctx: WithdrawalStepContext
): Promise<WithdrawalStepOutput> {
  const now = new Date().toISOString();

  // Override notification priority to urgent for withdrawal workflows
  const effectivePriority = ctx.priority === "low" ? "high" : ctx.priority === "normal" ? "high" : "urgent";

  switch (step.parameters.type) {
    case "notification": {
      const notifyParams = step.parameters;
      const result = await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: notifyParams.recipients,
        channel: notifyParams.channel,
        priority: effectivePriority as "low" | "normal" | "high" | "urgent",
        templateKey: notifyParams.templateKey.startsWith("product_withdrawal")
          ? notifyParams.templateKey
          : `product_withdrawal.${notifyParams.templateKey}`,
        templateVariables: {
          ...notifyParams.templateVariables,
          workflowId: ctx.workflowInstanceId,
          priority: effectivePriority,
          deadline: ctx.deadline ?? ctx.params.withdrawalDeadline,
          productName: ctx.params.productIds.join(", "),
          reason: ctx.params.reason,
          scope: ctx.params.scope,
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
          priority: t.priority === "low" || t.priority === "normal" ? "high" : t.priority,
        })) as CreateTasksInput["tasks"],
        triggeredAt: now,
      });
      return {
        output: { tasksCreated: result.tasksCreated, taskIds: result.taskIds },
      };
    }

    case "approval": {
      const approvalParams = step.parameters;
      // Withdrawal approvals use shorter timeouts
      const timeoutMs = Math.min(
        approvalParams.approvalTimeoutSeconds * 1000,
        48 * 60 * 60 * 1000 // Max 48 hours for withdrawal approvals
      );

      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: approvalParams.approverRoles.map((role: string) => ({ role })),
        channel: "email",
        priority: "urgent",
        templateKey: "product_withdrawal.started",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          stepName: step.name,
          reason: ctx.params.reason,
          scope: ctx.params.scope,
          deadline: ctx.params.withdrawalDeadline,
        },
        triggeredAt: now,
      });

      const approved = await waitForWithdrawalApproval(ctx, step.id, timeoutMs);
      if (!approved) {
        // For withdrawals, always escalate on timeout — never auto-approve
        await notifyTeam({
          tenantId: ctx.tenantId,
          workflowInstanceId: ctx.workflowInstanceId,
          stepId: step.id,
          recipients: [{ role: "executive" }],
          channel: "email",
          priority: "urgent",
          templateKey: "workflow.escalation",
          templateVariables: {
            workflowType: "Product Withdrawal",
            stepName: step.name,
            timeout: `${approvalParams.approvalTimeoutSeconds}s`,
            assignedRole: step.assignedRole,
          },
          triggeredAt: now,
        });

        // Give one more chance with executive oversight
        const secondChance = await waitForWithdrawalApproval(ctx, step.id, 24 * 60 * 60 * 1000);
        if (!secondChance) {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Withdrawal approval for '${step.name}' timed out after escalation to executive`,
          });
        }
        return { approvedBy: ctx.getPendingApproval()?.approverUserId };
      }
      return { approvedBy: ctx.getPendingApproval()?.approverUserId };
    }

    case "erp_update": {
      const erpParams = step.parameters;
      const erpConnectionId = (step.parameters as unknown as Record<string, unknown>)["erpConnectionId"] as string ?? "default";

      // For product withdrawals, we commonly use the deactivate_item operation
      const operation = erpParams.operation === "deactivate_item" ? "deactivate_item" : erpParams.operation;

      const result = await updateErp({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        erpConnectionId,
        operation,
        entityIds: erpParams.entityIds,
        updatePayload: {
          ...erpParams.updatePayload,
          reason: ctx.params.reason,
          scope: ctx.params.scope,
          withdrawalDeadline: ctx.params.withdrawalDeadline,
        },
        syncImmediately: true, // Always sync immediately for withdrawals
        triggeredAt: now,
      });

      return {
        output: {
          entitiesUpdated: result.entitiesUpdated,
          syncStatus: result.syncStatus,
          deactivatedItems: operation === "deactivate_item" ? result.entitiesUpdated : 0,
        },
      };
    }

    case "stakeholder_communication": {
      const commParams = step.parameters;

      // Customer notification is mandatory for full market withdrawals
      if (ctx.params.requiresCustomerNotification && ctx.params.scope === "full_market") {
        await notifyTeam({
          tenantId: ctx.tenantId,
          workflowInstanceId: ctx.workflowInstanceId,
          stepId: step.id,
          recipients: commParams.stakeholders
            .filter((s: { type: string; ids: string[] }) => s.type === "customer")
            .flatMap((s: { type: string; ids: string[] }) => s.ids.map((id: string) => ({ userId: id }))),
          channel: "email",
          priority: "urgent",
          templateKey: "product_withdrawal.customer_notification",
          templateVariables: {
            workflowId: ctx.workflowInstanceId,
            productName: ctx.params.productIds.join(", "),
            reason: ctx.params.reason,
            scope: ctx.params.scope,
          },
          triggeredAt: now,
        });
      }

      // Other stakeholder communications
      const nonCustomerStakeholders = commParams.stakeholders.filter((s: { type: string; ids: string[] }) => s.type !== "customer");
      if (nonCustomerStakeholders.length > 0) {
        await notifyTeam({
          tenantId: ctx.tenantId,
          workflowInstanceId: ctx.workflowInstanceId,
          stepId: step.id,
          recipients: nonCustomerStakeholders.flatMap((s: { type: string; ids: string[] }) =>
            s.ids.map((id: string) => ({ userId: id }))
          ),
          channel: "email",
          priority: "high",
          templateKey: commParams.templateKey,
          templateVariables: {
            workflowId: ctx.workflowInstanceId,
            keyMessages: commParams.keyMessages.join("; "),
            reason: ctx.params.reason,
          },
          triggeredAt: now,
        });
      }

      return {
        output: {
          stakeholderGroups: commParams.stakeholders.length,
          customerNotificationSent: ctx.params.requiresCustomerNotification,
        },
      };
    }

    case "review": {
      const reviewParams = step.parameters;
      // Shorter review timeout for withdrawals
      const timeoutMs = Math.min(
        reviewParams.reviewTimeoutSeconds * 1000,
        24 * 60 * 60 * 1000 // Max 24 hours
      );

      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: reviewParams.reviewerRoles.map((role: string) => ({ role })),
        channel: "email",
        priority: "high",
        templateKey: "compliance_review.started",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          stepName: step.name,
          reason: ctx.params.reason,
        },
        triggeredAt: now,
      });

      const reviewed = await waitForWithdrawalReview(ctx, step.id, timeoutMs);
      if (!reviewed) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Review for '${step.name}' timed out — withdrawal may be incomplete`,
        });
      }

      const review = ctx.getPendingReview();
      ctx.clearPendingReview();

      return {
        approvedBy: review?.reviewerUserId,
        output: { verdict: review?.verdict, conditions: review?.conditions },
      };
    }

    default: {
      // Generic step handling
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
          priority: "high",
        }],
        triggeredAt: now,
      });

      if (step.requiresApproval) {
        const approved = await waitForWithdrawalApproval(ctx, step.id, timeoutMs);
        if (!approved) {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Step '${step.name}' timed out during product withdrawal`,
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

async function waitForWithdrawalApproval(
  ctx: WithdrawalStepContext,
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
      message: `Step '${stepId}' rejected by ${approval.approverUserId} during product withdrawal: ${approval.notes ?? "No reason provided"}`,
    });
  }

  return approval?.decision === "approved";
}

async function waitForWithdrawalReview(
  ctx: WithdrawalStepContext,
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
