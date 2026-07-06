// Cascada — Compliance Review Workflow
// Temporal workflow that orchestrates the compliance review lifecycle:
// from regulation identification through impact assessment, legal review,
// regulatory filing, and portfolio-level compliance verification.
// Compliance reviews are triggered when new regulations are enacted
// and require a systematic assessment of the entire product portfolio
// or specific affected products.
//
// COMMAND plan only.
//
// Workflow lifecycle:
// 1. Notify compliance team of new regulation
// 2. Create assessment tasks for affected products
// 3. Await compliance team review of each product
// 4. Legal review (if required — external counsel or internal)
// 5. Regulatory filing (if required — pre-market notification, registration)
// 6. Quality verification of compliance measures
// 7. ERP update with compliance status
// 8. Stakeholder communication (regulatory bodies, customers)
// 9. Final compliance sign-off

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
  ComplianceReviewParams,
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

export interface ComplianceReviewWorkflowInput {
  tenantId: string;
  workflowInstanceId: string;
  initiatedByUserId: string;
  params: ComplianceReviewParams;
  steps: WorkflowStepDefinition[];
  deadline?: string;
  priority: "low" | "normal" | "high" | "urgent";
}

/**
 * Compliance Review Workflow — orchestrates the compliance review lifecycle.
 *
 * Compliance reviews are the broadest-scoped workflow in Cascada. They
 * can cover a single regulation affecting a few products, or a portfolio-wide
 * assessment triggered by multiple new regulations. The workflow must
 * handle both focused reviews and sweeping portfolio analyses.
 *
 * Key design decisions:
 * - Review scope can be full portfolio, affected products, or specific categories
 * - Legal review is a conditional gate (internal or external counsel)
 * - Regulatory filing may be required for each jurisdiction separately
 * - Multiple products can be reviewed in parallel via independent steps
 * - External counsel reviews have longer timeouts (5 business days default)
 * - Pre-market notifications require their own sub-workflow steps
 * - The workflow does NOT complete until all products are either compliant
 *   or have remediation plans (reformulation/label change/withdrawal workflows)
 */
export async function complianceReviewWorkflow(
  input: ComplianceReviewWorkflowInput
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
      workflowType: "compliance_review",
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
      await sleep("10 seconds");
      continue;
    }

    stepStates.set(nextStep.id, "running");
    const stepStartTime = new Date().toISOString();

    try {
      const result = await executeComplianceStep(nextStep, {
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

interface ComplianceStepContext {
  tenantId: string;
  workflowInstanceId: string;
  initiatedByUserId: string;
  params: ComplianceReviewParams;
  priority: string;
  deadline?: string;
  getPendingApproval: () => ApprovalSignal | null;
  clearPendingApproval: () => void;
  getPendingReview: () => ReviewSignal | null;
  clearPendingReview: () => void;
}

interface ComplianceStepOutput {
  approvedBy?: string;
  output?: Record<string, unknown>;
}

/**
 * Execute a single compliance review step.
 * Compliance reviews involve more legal and regulatory-specific
 * steps than other workflows: regulatory filings, external counsel
 * reviews, and pre-market notifications.
 */
async function executeComplianceStep(
  step: WorkflowStepDefinition,
  ctx: ComplianceStepContext
): Promise<ComplianceStepOutput> {
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
        templateKey: notifyParams.templateKey.startsWith("compliance_review")
          ? notifyParams.templateKey
          : `compliance_review.${notifyParams.templateKey}`,
        templateVariables: {
          ...notifyParams.templateVariables,
          workflowId: ctx.workflowInstanceId,
          priority: ctx.priority,
          deadline: ctx.deadline ?? ctx.params.reviewDeadline,
          regulationCount: String(ctx.params.regulationIds.length),
          productCount: String(ctx.params.productIds.length),
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
        templateKey: "compliance_review.filing_needed",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          stepName: step.name,
          jurisdictions: ctx.params.jurisdictions.join(", "),
          deadline: ctx.params.reviewDeadline,
        },
        triggeredAt: now,
      });

      const approved = await waitForComplianceApproval(ctx, step.id, timeoutMs);
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
              workflowType: "Compliance Review",
              stepName: step.name,
              timeout: `${approvalParams.approvalTimeoutSeconds}s`,
              assignedRole: step.assignedRole,
            },
            triggeredAt: now,
          });
          const escalatedTimeout = approvalParams.escalationChain?.[0]?.timeoutSeconds ?? 86400;
          const secondApproval = await waitForComplianceApproval(ctx, step.id, escalatedTimeout * 1000);
          if (!secondApproval) {
            throw ApplicationFailure.create({
              message: `TIMEOUT: Compliance approval for '${step.name}' timed out after escalation`,
            });
          }
          return { approvedBy: ctx.getPendingApproval()?.approverUserId };
        } else if (approvalParams.onTimeoutAction === "auto_approve") {
          return { approvedBy: "system_auto_approved" };
        } else {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Compliance approval for '${step.name}' timed out`,
          });
        }
      }
      return { approvedBy: ctx.getPendingApproval()?.approverUserId };
    }

    case "review": {
      const reviewParams = step.parameters;
      // External counsel reviews get longer timeouts
      const isExternalCounsel = reviewParams.reviewerRoles.includes("legal_team") && ctx.params.requiresExternalCounsel;
      const baseTimeout = reviewParams.reviewTimeoutSeconds * 1000;
      const timeoutMs = isExternalCounsel
        ? Math.max(baseTimeout, 5 * 24 * 60 * 60 * 1000) // Minimum 5 business days for external counsel
        : baseTimeout;

      await notifyTeam({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        recipients: reviewParams.reviewerRoles.map((role: string) => ({ role })),
        channel: "email",
        priority: "normal",
        templateKey: "compliance_review.started",
        templateVariables: {
          workflowId: ctx.workflowInstanceId,
          stepName: step.name,
          jurisdictions: ctx.params.jurisdictions.join(", "),
          reviewScope: ctx.params.reviewScope,
        },
        triggeredAt: now,
      });

      const reviewed = await waitForComplianceReview(ctx, step.id, timeoutMs);
      if (!reviewed) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Compliance review for '${step.name}' timed out${isExternalCounsel ? " (external counsel)" : ""}`,
        });
      }

      const review = ctx.getPendingReview();
      ctx.clearPendingReview();

      if (review?.verdict === "fail") {
        throw ApplicationFailure.create({
          message: `Compliance review failed for '${step.name}': ${review.conditions?.join(", ") ?? "No conditions"}`,
        });
      }

      return {
        approvedBy: review?.reviewerUserId,
        output: {
          verdict: review?.verdict,
          conditions: review?.conditions,
          isExternalCounsel,
        },
      };
    }

    case "regulatory_filing": {
      const filingParams = step.parameters;
      const timeoutMs = step.timeoutSeconds * 1000;

      await createTasks({
        tenantId: ctx.tenantId,
        workflowInstanceId: ctx.workflowInstanceId,
        stepId: step.id,
        tasks: filingParams.productIds.map((productId: string, idx: number) => ({
          title: `${filingParams.filingType} filing — ${filingParams.jurisdiction} (${idx + 1}/${filingParams.productIds.length})`,
          description: `Prepare and submit ${filingParams.filingType} filing for jurisdiction ${filingParams.jurisdiction}. Product: ${productId}. Required documents: ${filingParams.requiredDocuments.join(", ")}. Deadline: ${filingParams.deadlineDate}`,
          assignedRole: "regulatory_affairs",
          dueDateOffsetDays: step.estimatedDurationDays,
          priority: step.isCriticalPath ? "high" : "normal",
        })),
        triggeredAt: now,
      });

      // Filing requires approval before submission
      const approved = await waitForComplianceApproval(ctx, step.id, timeoutMs);
      if (!approved) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Regulatory filing for '${step.name}' timed out — filing deadline may be missed`,
        });
      }

      return {
        approvedBy: ctx.getPendingApproval()?.approverUserId,
        output: {
          filingType: filingParams.filingType,
          jurisdiction: filingParams.jurisdiction,
          productsFiled: filingParams.productIds.length,
        },
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
          regulationIds: ctx.params.regulationIds,
          jurisdictions: ctx.params.jurisdictions,
          reviewScope: ctx.params.reviewScope,
          complianceStatus: "under_review",
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
          title: `Compliance verification — ${productId}`,
          description: `Verify compliance for product ${productId} against ${qcParams.checkType} requirements. Specifications: ${qcParams.specificationIds.join(", ")}`,
          assignedRole: "quality_team",
          dueDateOffsetDays: step.estimatedDurationDays,
          priority: step.isCriticalPath ? "high" : "normal",
        })),
        triggeredAt: now,
      });

      const reviewed = await waitForComplianceReview(ctx, step.id, timeoutMs);
      if (!reviewed) {
        throw ApplicationFailure.create({
          message: `TIMEOUT: Quality check for '${step.name}' timed out`,
        });
      }

      return {
        output: {
          productsChecked: qcParams.productIds.length,
          checkType: qcParams.checkType,
        },
      };
    }

    case "stakeholder_communication": {
      const commParams = step.parameters;

      // Regulatory bodies get separate, formal communications
      const regulatoryStakeholders = commParams.stakeholders.filter((s: { type: string; ids: string[] }) => s.type === "regulatory_body");
      const otherStakeholders = commParams.stakeholders.filter((s: { type: string; ids: string[] }) => s.type !== "regulatory_body");

      if (regulatoryStakeholders.length > 0) {
        await notifyTeam({
          tenantId: ctx.tenantId,
          workflowInstanceId: ctx.workflowInstanceId,
          stepId: step.id,
          recipients: regulatoryStakeholders.flatMap((s: { type: string; ids: string[] }) =>
            s.ids.map((id: string) => ({ userId: id }))
          ),
          channel: "email",
          priority: "high",
          templateKey: "compliance_review.filing_needed",
          templateVariables: {
            workflowId: ctx.workflowInstanceId,
            keyMessages: commParams.keyMessages.join("; "),
            jurisdictions: ctx.params.jurisdictions.join(", "),
          },
          triggeredAt: now,
        });
      }

      if (otherStakeholders.length > 0) {
        await notifyTeam({
          tenantId: ctx.tenantId,
          workflowInstanceId: ctx.workflowInstanceId,
          stepId: step.id,
          recipients: otherStakeholders.flatMap((s: { type: string; ids: string[] }) =>
            s.ids.map((id: string) => ({ userId: id }))
          ),
          channel: "email",
          priority: "normal",
          templateKey: commParams.templateKey,
          templateVariables: {
            workflowId: ctx.workflowInstanceId,
            keyMessages: commParams.keyMessages.join("; "),
            jurisdictions: ctx.params.jurisdictions.join(", "),
          },
          triggeredAt: now,
        });
      }

      return {
        output: {
          stakeholderGroups: commParams.stakeholders.length,
          regulatoryCommunications: regulatoryStakeholders.length,
        },
      };
    }

    default: {
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
        const approved = await waitForComplianceApproval(ctx, step.id, timeoutMs);
        if (!approved) {
          throw ApplicationFailure.create({
            message: `TIMEOUT: Step '${step.name}' timed out during compliance review`,
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

async function waitForComplianceApproval(
  ctx: ComplianceStepContext,
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
      message: `Compliance step '${stepId}' rejected by ${approval.approverUserId}: ${approval.notes ?? "No reason provided"}`,
    });
  }

  return approval?.decision === "approved";
}

async function waitForComplianceReview(
  ctx: ComplianceStepContext,
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
