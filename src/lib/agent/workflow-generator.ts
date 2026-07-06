// Cascada — Workflow Generator Agent
// Generates Temporal workflow definitions from decision packages.
// Translates executive decisions (accept/reject/defer/partial) into orchestrated
// compliance actions with step-by-step assignments, dependencies, and timelines.
//
// This agent is COMMAND-plan only — it requires the full platform tier.

import { generateObject } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getPrimaryModel,
  getFallbackModel,
  getTemperatureForTask,
  calculateLlmCost,
} from "@/lib/llm/client";
import { logLlmUsage } from "@/lib/llm/cost-tracker";
import { executeWithFallback } from "@/lib/llm/fallback";
import { createAgentLogger } from "@/lib/logger";
import { AgentError, AgentPlanAccessError, AgentBudgetError } from "@/lib/errors";
import type {
  AgentExecutionContext,
  AgentExecutionResult,
  AgentMessage,
  WorkflowGeneratorInput,
  WorkflowGeneratorResult,
  GeneratedWorkflow,
  GeneratedWorkflowStep,
  WorkflowType,
  WorkflowStepType,
  RAGContext,
} from "./types";
import { AGENT_CONFIG } from "./types";
import { buildAgentContext, serializeContextForPrompt } from "./context";

// ============================================================================
// Workflow Output Schema (for LLM structured output)
// ============================================================================

export const WorkflowOutputSchema = z.object({
  name: z.string().min(5, "Workflow name must be descriptive"),
  type: z.enum([
    "reformulation",
    "label_change",
    "product_withdrawal",
    "compliance_review",
    "supplier_transition",
    "mixed",
  ]).describe("Primary workflow type"),
  description: z.string().min(20, "Workflow description must be at least 20 characters"),
  estimatedDurationDays: z.number().int().min(1).describe("Total estimated duration in days"),
  steps: z.array(
    z.object({
      id: z.string().regex(/^step_\d+$/, "Step ID must be step_N format"),
      name: z.string().min(3, "Step name is required"),
      description: z.string().min(10, "Step description must be at least 10 characters"),
      type: z.enum([
        "notification",
        "task_creation",
        "erp_update",
        "approval",
        "review",
        "testing",
        "regulatory_filing",
        "supplier_negotiation",
        "production_change",
        "label_update",
        "quality_check",
        "stakeholder_communication",
      ]),
      assignedRole: z.string().describe("Role responsible (e.g., 'COMPLIANCE', 'R&D', 'EXECUTIVE')"),
      estimatedDurationDays: z.number().int().min(1),
      dependsOn: z.array(z.string()).describe("Step IDs this depends on"),
      requiresApproval: z.boolean(),
      parameters: z.record(z.unknown()).describe("Step-specific parameters"),
      isCriticalPath: z.boolean().describe("Whether this step is on the critical path"),
    })
  ).min(1, "At least one step is required"),
  estimatedCost: z.number().nullable().describe("Total estimated cost in USD"),
  riskFactors: z.array(z.string()).min(1, "At least one risk factor must be identified"),
  milestones: z.array(
    z.object({
      name: z.string(),
      targetDate: z.string().describe("ISO 8601 date"),
      dependsOn: z.array(z.string()).describe("Step IDs this milestone depends on"),
    })
  ).min(1, "At least one milestone is required"),
});

export type WorkflowOutput = z.infer<typeof WorkflowOutputSchema>;

// ============================================================================
// Workflow Generation Prompt
// ============================================================================

const WORKFLOW_GENERATOR_SYSTEM_PROMPT = `You are a compliance workflow architect for a food manufacturing company. Your task is to generate detailed, actionable workflow definitions from executive decisions about regulatory compliance actions.

## Your Role
- Transform a decision package into a step-by-step Temporal workflow
- Determine the correct workflow type based on the decision
- Assign responsibilities to appropriate roles
- Set realistic timelines with dependencies
- Identify risks and critical path
- Generate milestones for tracking progress

## Workflow Types
1. **reformulation** — Replace a banned/restricted ingredient with a substitute
2. **label_change** — Update product labels to meet new requirements
3. **product_withdrawal** — Remove products from the market
4. **compliance_review** — Review and validate compliance status
5. **supplier_transition** — Switch to a different ingredient supplier
6. **mixed** — Combination of multiple workflow types

## Step Types
- **notification** — Alert stakeholders about the action
- **task_creation** — Create tasks in the project management system
- **erp_update** — Update ERP records (formulations, BOMs, specs)
- **approval** — Require sign-off from a role
- **review** — Review documentation or test results
- **testing** — Conduct laboratory or sensory testing
- **regulatory_filing** — Submit documents to regulatory bodies
- **supplier_negotiation** — Negotiate terms with suppliers
- **production_change** — Modify production processes
- **label_update** — Update product labels and packaging
- **quality_check** — Verify quality standards are met
- **stakeholder_communication** — Inform customers, retailers, or the public

## Rules
1. Every workflow must start with a notification step
2. Every workflow must end with a quality_check and stakeholder_communication
3. Steps that modify production must have an approval step before them
4. Critical path steps must be clearly marked
5. Dependencies must form a valid DAG (no circular dependencies)
6. Estimated duration must be realistic for the action type
7. Risk factors must be specific to this workflow, not generic
8. The compliance deadline from the decision package must be respected
9. Include buffer time for testing iterations and rework
10. Consider parallel steps where possible to minimize timeline

## Strict Rules
- Never generate a workflow without at least 3 steps
- Never assign a step to a role that doesn't exist in the system
- Never create circular dependencies between steps
- Always include the executive decision as context for the workflow
- Never estimate less than 5 business days for any reformulation workflow` as const;

// ============================================================================
// Main Agent Execution
// ============================================================================

/**
 * Execute the Workflow Generator Agent.
 * Takes a decision package and generates a Temporal workflow definition.
 */
export async function executeWorkflowGeneratorAgent(
  input: WorkflowGeneratorInput,
  context: AgentExecutionContext
): Promise<WorkflowGeneratorResult> {
  const logger = createAgentLogger("workflow_generator", "execute");
  const startTime = Date.now();

  // 1. Plan access check — COMMAND plan only
  if (context.plan !== "COMMAND") {
    throw new AgentPlanAccessError("workflow_generator", context.plan);
  }

  // 2. Budget check
  const budget = await checkLlmBudget(context.tenantId);
  if (!budget.allowed) {
    throw new AgentBudgetError("workflow_generator", context.tenantId, budget.remaining);
  }

  logger.info(
    {
      tenantId: context.tenantId,
      userId: context.userId,
      decisionPackageId: input.decisionPackageId,
      decision: input.decision,
      hasModifications: !!input.modifications,
    },
    "Workflow generator agent starting"
  );

  // 3. Get the decision package
  const decisionPackage = await prisma.decisionPackage.findUnique({
    where: { id: input.decisionPackageId, tenantId: context.tenantId },
    include: {
      trigger: {
        include: {
          impacts: {
            take: 20,
            orderBy: { priority: "desc" },
          },
          rule: {
            include: {
              source: { select: { name: true, jurisdiction: true } },
              substances: {
                where: { isMatched: true },
                take: 10,
                include: {
                  ingredient: {
                    select: { id: true, name: true, category: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!decisionPackage) {
    throw new AgentError(
      `Decision package ${input.decisionPackageId} not found`,
      "workflow_generator",
      { tenantId: context.tenantId, decisionPackageId: input.decisionPackageId }
    );
  }

  // 4. Build RAG context
  const ragContext = await buildAgentContext({
    tenantId: context.tenantId,
    agentType: "workflow_generator",
    focusTriggerIds: [decisionPackage.triggerId],
  });

  // 5. Build the prompt with decision package details
  const userPrompt = buildWorkflowGeneratorPrompt(decisionPackage, input, ragContext);

  // 6. Build system prompt
  const systemPrompt = [
    WORKFLOW_GENERATOR_SYSTEM_PROMPT,
    "",
    "## Decision Package Context",
    `Title: ${decisionPackage.title}`,
    `Decision: ${input.decision}`,
    input.decisionNotes ? `Notes: ${input.decisionNotes}` : "",
    "",
    "## Available Data",
    serializeContextForPrompt(ragContext),
  ].join("\n");

  // 7. Execute LLM call with structured output
  const modelId = "gpt-4o"; // Workflow generation uses the heavy model
  let llmResult: WorkflowOutput;
  let usageData: { promptTokens: number; completionTokens: number; totalTokens: number };
  let usedFallback = false;

  try {
    const result = await executeWithFallback(
      async () => {
        const model = getPrimaryModel("decision_package");
        return generateObject({
          model,
          schema: WorkflowOutputSchema,
          prompt: userPrompt,
          system: systemPrompt,
          temperature: getTemperatureForTask("decision_package"),
          maxRetries: 2,
        });
      },
      async () => {
        logger.warn({ tenantId: context.tenantId }, "Primary model failed, using fallback");
        usedFallback = true;
        const model = getFallbackModel("decision_package");
        return generateObject({
          model,
          schema: WorkflowOutputSchema,
          prompt: userPrompt,
          system: systemPrompt,
          temperature: getTemperatureForTask("decision_package"),
          maxRetries: 1,
        });
      },
      "decision_package"
    );

    usedFallback = usedFallback || result.usedFallback;
    llmResult = result.result.object as WorkflowOutput;

    const pu = result.result.usage;
    usageData = {
      promptTokens: pu?.inputTokens ?? 0,
      completionTokens: pu?.outputTokens ?? 0,
      totalTokens: (pu?.inputTokens ?? 0) + (pu?.outputTokens ?? 0),
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logLlmUsage({
      tenantId: context.tenantId,
      model: modelId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      taskType: "decision_package",
      success: false,
      errorMessage,
      latencyMs,
    });

    throw new AgentError(
      `Workflow generator failed: ${errorMessage}`,
      "workflow_generator",
      { tenantId: context.tenantId, decisionPackageId: input.decisionPackageId }
    );
  }

  const latencyMs = Date.now() - startTime;
  const costUsd = calculateLlmCost(
    usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    usageData.promptTokens,
    usageData.completionTokens
  );

  // Log usage
  await logLlmUsage({
    tenantId: context.tenantId,
    model: usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    promptTokens: usageData.promptTokens,
    completionTokens: usageData.completionTokens,
    totalTokens: usageData.totalTokens,
    costUsd,
    taskType: "decision_package",
    success: true,
    latencyMs,
  });

  // 8. Validate the generated workflow
  const validation = validateWorkflow(llmResult);

  // 9. Apply modifications if provided
  let modifiedWorkflow = llmResult;
  if (input.modifications) {
    modifiedWorkflow = applyModifications(llmResult, input.modifications);
  }

  // 10. Create WorkflowInstance in the database
  const workflowInstance = await prisma.workflowInstance.create({
    data: {
      tenantId: context.tenantId,
      decisionPackageId: input.decisionPackageId,
      workflowType: modifiedWorkflow.type,
      status: "PENDING",
      currentStep: modifiedWorkflow.steps[0]?.id,
      steps: modifiedWorkflow.steps.map((step) => ({
        id: step.id,
        name: step.name,
        description: step.description,
        type: step.type,
        assignedRole: step.assignedRole,
        estimatedDurationDays: step.estimatedDurationDays,
        dependsOn: step.dependsOn,
        requiresApproval: step.requiresApproval,
        isCriticalPath: step.isCriticalPath,
        status: "pending",
      })),
      assignedTo: [],
    },
  });

  // 11. Update decision package with the decision
  if (!decisionPackage.decision) {
    await prisma.decisionPackage.update({
      where: { id: input.decisionPackageId },
      data: {
        decision: input.decision,
        decidedBy: context.userId,
        decidedAt: new Date(),
        decisionNotes: input.decisionNotes,
      },
    });
  }

  // 12. Build response
  const generatedWorkflow: GeneratedWorkflow = {
    name: modifiedWorkflow.name,
    type: modifiedWorkflow.type as WorkflowType,
    description: modifiedWorkflow.description,
    estimatedDurationDays: modifiedWorkflow.estimatedDurationDays,
    steps: modifiedWorkflow.steps.map((step): GeneratedWorkflowStep => ({
      id: step.id,
      name: step.name,
      description: step.description,
      type: step.type as WorkflowStepType,
      assignedRole: step.assignedRole,
      estimatedDurationDays: step.estimatedDurationDays,
      dependsOn: step.dependsOn,
      requiresApproval: step.requiresApproval,
      parameters: step.parameters,
      isCriticalPath: step.isCriticalPath,
    })),
    estimatedCost: modifiedWorkflow.estimatedCost,
    riskFactors: modifiedWorkflow.riskFactors,
    milestones: modifiedWorkflow.milestones,
  };

  const responseContent = formatWorkflowResponse(generatedWorkflow, validation);

  const userMessage: AgentMessage = {
    id: `msg_${Date.now()}_u`,
    role: "user",
    content: `Generate workflow for decision package: ${decisionPackage.title} (Decision: ${input.decision})`,
    timestamp: new Date().toISOString(),
  };

  const assistantMessage: AgentMessage = {
    id: `msg_${Date.now()}_a`,
    role: "assistant",
    content: responseContent,
    timestamp: new Date().toISOString(),
    usage: usageData,
  };

  logger.info(
    {
      tenantId: context.tenantId,
      decisionPackageId: input.decisionPackageId,
      workflowType: modifiedWorkflow.type,
      stepCount: modifiedWorkflow.steps.length,
      workflowInstanceId: workflowInstance.id,
      validationValid: validation.isValid,
      tokensUsed: usageData.totalTokens,
      costUsd: costUsd.toFixed(6),
      latencyMs,
      usedFallback,
    },
    "Workflow generator agent completed"
  );

  return {
    content: responseContent,
    toolCalls: [],
    messages: [userMessage, assistantMessage],
    usage: { ...usageData, costUsd },
    model: usedFallback ? "claude-3-5-sonnet-20241022" : modelId,
    usedFallback,
    latencyMs,
    contextUsed: ragContext,
    traceId: context.traceId,
    workflow: generatedWorkflow,
    validation,
  };
}

// ============================================================================
// Prompt Builder
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildWorkflowGeneratorPrompt(
  decisionPackage: any,
  input: WorkflowGeneratorInput,
  ragContext: RAGContext
): string {
  const sections: string[] = [];

  sections.push(`## Decision Package: ${decisionPackage.title}`);
  sections.push(`Decision: ${input.decision}`);
  if (input.decisionNotes) {
    sections.push(`Executive Notes: ${input.decisionNotes}`);
  }

  sections.push("");
  sections.push("### Mandate Summary");
  sections.push(decisionPackage.mandateSummary?.slice(0, 2000) ?? "No summary available");

  sections.push("");
  sections.push("### Affected SKUs");
  const skuList = decisionPackage.affectedSkuList as Array<{ sku: string; name: string }> | null;
  if (skuList && skuList.length > 0) {
    skuList.slice(0, 30).forEach((s) => {
      sections.push(`- ${s.name} (${s.sku})`);
    });
    if (skuList.length > 30) {
      sections.push(`... and ${skuList.length - 30} more`);
    }
  } else {
    sections.push("No SKU details available");
  }

  sections.push("");
  sections.push("### Impacts");
  if (decisionPackage.trigger?.impacts) {
    for (const impact of decisionPackage.trigger.impacts.slice(0, 10)) {
      sections.push(`- [${impact.impactType}] ${impact.description}${impact.reformRequired ? " [REFORMULATION REQUIRED]" : ""}${impact.financialImpact ? ` ($${Number(impact.financialImpact).toLocaleString()})` : ""}`);
    }
  }

  sections.push("");
  sections.push("### Regulatory Context");
  if (decisionPackage.trigger?.rule) {
    const rule = decisionPackage.trigger.rule;
    sections.push(`Regulation: ${rule.source.name} (${rule.source.jurisdiction})`);
    sections.push(`Rule type: ${rule.ruleType}`);
    if (rule.complianceDate) {
      sections.push(`Compliance deadline: ${rule.complianceDate.toISOString().slice(0, 10)}`);
    }
    if (rule.substances?.length > 0) {
      sections.push("Affected substances:");
      rule.substances.forEach((s: { substanceName: string; ingredient: { name: string } | null }) => {
        sections.push(`- ${s.substanceName}${s.ingredient ? ` (matched to: ${s.ingredient.name})` : ""}`);
      });
    }
  }

  sections.push("");
  sections.push("### Recommendation");
  sections.push(decisionPackage.recommendation?.slice(0, 1000) ?? "No recommendation available");

  // Modifications
  if (input.modifications) {
    sections.push("");
    sections.push("### Requested Modifications");
    if (input.modifications.skipSteps?.length) {
      sections.push(`Skip steps: ${input.modifications.skipSteps.join(", ")}`);
    }
    if (input.modifications.addSteps?.length) {
      sections.push("Add steps:");
      input.modifications.addSteps.forEach((s) => {
        sections.push(`- ${s.name}: ${s.description}${s.assignee ? ` (Assignee: ${s.assignee})` : ""}`);
      });
    }
    if (input.modifications.changeTimeline) {
      sections.push(`Change timeline deadline to: ${input.modifications.changeTimeline.deadline}`);
    }
  }

  sections.push("");
  sections.push("Generate a complete workflow definition for this decision. Include all necessary steps, dependencies, and milestones. Ensure the workflow can be completed before the compliance deadline.");

  return sections.join("\n");
}

// ============================================================================
// Workflow Validation
// ============================================================================

interface WorkflowValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

function validateWorkflow(workflow: WorkflowOutput): WorkflowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for circular dependencies
  const stepIds = new Set(workflow.steps.map((s) => s.id));
  for (const step of workflow.steps) {
    for (const dep of step.dependsOn) {
      if (!stepIds.has(dep)) {
        errors.push(`Step '${step.id}' depends on non-existent step '${dep}'`);
      }
    }
  }

  // Check for circular dependencies using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const adjacency: Map<string, string[]> = new Map();

  for (const step of workflow.steps) {
    adjacency.set(step.id, step.dependsOn);
  }

  function hasCycle(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const step of workflow.steps) {
    if (!visited.has(step.id)) {
      if (hasCycle(step.id)) {
        errors.push("Circular dependency detected in workflow steps");
        break;
      }
    }
  }

  // Check first step is a notification
  const firstSteps = workflow.steps.filter((s) => s.dependsOn.length === 0);
  if (firstSteps.length === 0) {
    errors.push("No starting step found (all steps have dependencies)");
  }
  if (firstSteps.length > 0 && !firstSteps.some((s) => s.type === "notification")) {
    warnings.push("First step should be a notification type");
  }

  // Check for approval before production changes
  for (const step of workflow.steps) {
    if (step.type === "production_change" || step.type === "erp_update") {
      const hasApprovalDependency = checkDependencyChain(step, workflow.steps, "approval");
      if (!hasApprovalDependency) {
        warnings.push(`Step '${step.name}' (${step.type}) should require an approval step before it`);
      }
    }
  }

  // Check estimated duration is reasonable
  const totalStepDays = workflow.steps.reduce((sum, s) => sum + s.estimatedDurationDays, 0);
  if (workflow.estimatedDurationDays > totalStepDays * 2) {
    warnings.push("Estimated total duration seems much longer than sum of step durations");
  }

  // Check critical path
  const criticalSteps = workflow.steps.filter((s) => s.isCriticalPath);
  if (criticalSteps.length === 0) {
    warnings.push("No steps marked as critical path");
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function checkDependencyChain(
  step: { dependsOn: string[] },
  allSteps: Array<{ id: string; type: string; dependsOn: string[] }>,
  targetType: string,
  depth: number = 3
): boolean {
  if (depth <= 0) return false;

  for (const depId of step.dependsOn) {
    const depStep = allSteps.find((s) => s.id === depId);
    if (!depStep) continue;
    if (depStep.type === targetType) return true;
    if (checkDependencyChain(depStep, allSteps, targetType, depth - 1)) return true;
  }

  return false;
}

// ============================================================================
// Modification Application
// ============================================================================

function applyModifications(
  workflow: WorkflowOutput,
  modifications: NonNullable<WorkflowGeneratorInput["modifications"]>
): WorkflowOutput {
  let modified = { ...workflow };

  // Skip steps
  if (modifications.skipSteps && modifications.skipSteps.length > 0) {
    const skipSet = new Set(modifications.skipSteps);
    modified.steps = modified.steps
      .filter((s) => !skipSet.has(s.id))
      .map((s) => ({
        ...s,
        dependsOn: s.dependsOn.filter((d) => !skipSet.has(d)),
      }));
  }

  // Add steps
  if (modifications.addSteps && modifications.addSteps.length > 0) {
    const newSteps = modifications.addSteps.map((ms, i) => ({
      id: `step_custom_${i + 1}`,
      name: ms.name,
      description: ms.description,
      type: "task_creation" as const,
      assignedRole: ms.assignee ?? "COMPLIANCE",
      estimatedDurationDays: 5,
      dependsOn: [] as string[],
      requiresApproval: false,
      parameters: {},
      isCriticalPath: false,
    }));
    modified.steps = [...modified.steps, ...newSteps];
  }

  // Change timeline
  if (modifications.changeTimeline) {
    // Adjust estimated duration based on new deadline
    const newDeadline = new Date(modifications.changeTimeline.deadline);
    const daysUntilDeadline = Math.max(1, Math.ceil((newDeadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    modified.estimatedDurationDays = Math.min(modified.estimatedDurationDays, daysUntilDeadline);
  }

  return modified;
}

// ============================================================================
// Response Formatting
// ============================================================================

function formatWorkflowResponse(
  workflow: GeneratedWorkflow,
  validation: WorkflowValidation
): string {
  const parts: string[] = [];

  parts.push(`# Workflow: ${workflow.name}`);
  parts.push(`Type: ${workflow.type.replace(/_/g, " ")} | Duration: ~${workflow.estimatedDurationDays} days${workflow.estimatedCost ? ` | Est. Cost: $${workflow.estimatedCost.toLocaleString()}` : ""}`);
  parts.push("");
  parts.push(workflow.description);
  parts.push("");

  // Steps
  parts.push("## Steps");
  workflow.steps.forEach((step, i) => {
    const criticalFlag = step.isCriticalPath ? " ⭐ CRITICAL PATH" : "";
    const approvalFlag = step.requiresApproval ? " 🔒 REQUIRES APPROVAL" : "";
    const depList = step.dependsOn.length > 0 ? ` | After: ${step.dependsOn.join(", ")}` : "";
    parts.push(`${i + 1}. **${step.name}** (${step.type.replace(/_/g, " ")})${criticalFlag}${approvalFlag}`);
    parts.push(`   ${step.description}`);
    parts.push(`   Assigned: ${step.assignedRole} | Duration: ~${step.estimatedDurationDays} days${depList}`);
  });

  // Milestones
  parts.push("");
  parts.push("## Milestones");
  workflow.milestones.forEach((ms) => {
    parts.push(`- **${ms.name}** — Target: ${ms.targetDate.slice(0, 10)}`);
  });

  // Risk factors
  parts.push("");
  parts.push("## Risk Factors");
  workflow.riskFactors.forEach((rf) => {
    parts.push(`- ${rf}`);
  });

  // Validation results
  if (!validation.isValid) {
    parts.push("");
    parts.push("⚠️ **Validation Errors**:");
    validation.errors.forEach((e) => parts.push(`- ❌ ${e}`));
  }
  if (validation.warnings.length > 0) {
    parts.push("");
    parts.push("⚠️ **Warnings**:");
    validation.warnings.forEach((w) => parts.push(`- ⚡ ${w}`));
  }

  return parts.join("\n");
}

// ============================================================================
// Budget Enforcement
// ============================================================================

async function checkLlmBudget(
  tenantId: string
): Promise<{ allowed: boolean; remaining: number }> {
  const budget = AGENT_CONFIG.TOKEN_BUDGETS.COMMAND;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const usage = await prisma.llmUsageLog.aggregate({
    where: {
      tenantId,
      taskType: { in: ["query_agent", "reformulation", "decision_package"] },
      createdAt: { gte: todayStart },
      success: true,
    },
    _sum: { totalTokens: true },
  });

  const usedToday = usage._sum.totalTokens ?? 0;
  return {
    allowed: budget.daily - usedToday > 0,
    remaining: Math.max(0, budget.daily - usedToday),
  };
}
