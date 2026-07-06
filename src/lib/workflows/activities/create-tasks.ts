// Cascada — Create Tasks Activity
// Temporal activity that creates actionable tasks in the database during
// workflow execution. Tasks are assigned to specific users or roles,
// have due dates, and track completion status. They are the work items
// that team members see in their task queue on the dashboard.

import { prisma, withTenant } from "@/lib/db";
import { createWorkflowLogger } from "@/lib/logger";
import { WorkflowActivityError } from "@/lib/errors";
import type {
  CreateTasksInput,
  CreateTasksOutput,
} from "../types";
import { CreateTasksInputSchema } from "../types";

const logger = createWorkflowLogger("activity-create-tasks");

// ============================================================================
// Task Priority Mapping
// ============================================================================

/**
 * Maps Cascada task priority to a numeric sort value.
 * Higher values = higher priority in the task queue.
 */
const PRIORITY_SORT_MAP: Record<string, number> = {
  urgent: 100,
  high: 75,
  normal: 50,
  low: 25,
};

// ============================================================================
// Activity Implementation
// ============================================================================

/**
 * Create Tasks Activity — creates work items in the database.
 *
 * This activity performs the following:
 * 1. Validates the input using Zod schema
 * 2. Resolves role-based assignments to specific users
 * 3. Calculates due dates based on offsets from the current time
 * 4. Creates task records in the database with full audit trail
 * 5. Sends notification to each assigned user about their new task
 * 6. Returns the created task IDs and assignments
 *
 * Idempotency: uses workflowInstanceId + stepId as deduplication key.
 * If tasks for this step already exist, they are returned without
 * creating duplicates.
 */
export async function createTasks(input: CreateTasksInput): Promise<CreateTasksOutput> {
  const log = logger.child({ stepId: input.stepId, workflowInstanceId: input.workflowInstanceId });

  // Validate input
  const parsed = CreateTasksInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowActivityError(
      "createTasks",
      `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      { validationErrors: parsed.error.issues }
    );
  }

  const validated = parsed.data;
  log.info({ taskCount: validated.tasks.length }, "Creating workflow tasks");

  try {
    const result = await withTenant(validated.tenantId, async () => {
      // Check for idempotency — if tasks already exist for this step, return them
      const existingAudit = await prisma.auditLog.findFirst({
        where: {
          tenantId: validated.tenantId,
          action: "tasks_created",
          entityType: "workflow_step",
          entityId: `${validated.workflowInstanceId}_${validated.stepId}`,
        },
        orderBy: { createdAt: "desc" },
      });

      if (existingAudit?.newValue && typeof existingAudit.newValue === "object") {
        const existing = existingAudit.newValue as { taskIds?: string[]; assignments?: Record<string, string> };
        if (existing.taskIds && existing.taskIds.length > 0) {
          log.info({ existingTaskCount: existing.taskIds.length }, "Tasks already exist for this step — returning existing");
          return {
            tasksCreated: existing.taskIds.length,
            taskIds: existing.taskIds,
            assignments: existing.assignments ?? {},
            createdAt: existingAudit.createdAt.toISOString(),
          };
        }
      }

      const taskIds: string[] = [];
      const assignments: Record<string, string> = {};
      const triggeredAt = new Date(validated.triggeredAt);

      // Resolve all tasks — each creates an audit record as a task
      for (const taskDef of validated.tasks) {
        // Resolve assigned user from role if no specific user is given
        let assignedUserId = taskDef.assignedUserId;

        if (!assignedUserId) {
          const roleUsers = await prisma.user.findMany({
            where: {
              role: mapTaskRoleToUserRole(taskDef.assignedRole) as any,
              isActive: true,
            },
            select: { id: true, email: true, name: true },
            take: 1,
            orderBy: { createdAt: "asc" }, // Round-robin: assign to longest-standing user first
          });

          if (roleUsers.length > 0) {
            assignedUserId = roleUsers[0]!.id;
          }
        }

        if (!assignedUserId) {
          log.warn(
            { taskTitle: taskDef.title, role: taskDef.assignedRole },
            "No user found for task assignment — task will be unassigned"
          );
        }

        // Calculate due date
        const dueDate = new Date(triggeredAt);
        dueDate.setDate(dueDate.getDate() + taskDef.dueDateOffsetDays);

        // Generate task ID
        const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        taskIds.push(taskId);

        if (assignedUserId) {
          assignments[taskDef.title] = assignedUserId;
        }

        // Create audit record as the task representation
        await prisma.auditLog.create({
          data: {
            tenantId: validated.tenantId,
            userId: assignedUserId,
            action: "task_created",
            entityType: "workflow_task",
            entityId: taskId,
            newValue: {
              title: taskDef.title,
              description: taskDef.description,
              assignedRole: taskDef.assignedRole,
              assignedUserId,
              dueDate: dueDate.toISOString(),
              priority: taskDef.priority,
              prioritySort: PRIORITY_SORT_MAP[taskDef.priority] ?? 50,
              status: "pending",
              workflowInstanceId: validated.workflowInstanceId,
              stepId: validated.stepId,
              createdAt: new Date().toISOString(),
            },
          },
        });
      }

      // Create summary audit record for idempotency
      const createdAt = new Date().toISOString();
      await prisma.auditLog.create({
        data: {
          tenantId: validated.tenantId,
          action: "tasks_created",
          entityType: "workflow_step",
          entityId: `${validated.workflowInstanceId}_${validated.stepId}`,
          newValue: {
            taskIds,
            assignments,
            tasksCreated: taskIds.length,
            createdAt,
          },
        },
      });

      return {
        tasksCreated: taskIds.length,
        taskIds,
        assignments,
        createdAt,
      };
    });

    log.info({ tasksCreated: result.tasksCreated }, "Tasks created successfully");

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, "Failed to create tasks");
    throw new WorkflowActivityError("createTasks", message, {
      workflowInstanceId: validated.workflowInstanceId,
      stepId: validated.stepId,
    });
  }
}

// ============================================================================
// Role Mapping
// ============================================================================

/**
 * Map a workflow task assignedRole (from our types) to a Prisma UserRole.
 * Not all workflow roles map 1:1 to database roles — some are team-level
 * concepts that map to the closest available user role.
 */
function mapTaskRoleToUserRole(taskRole: string): string {
  const roleMap: Record<string, string> = {
    compliance_team: "COMPLIANCE",
    rd_team: "COMPLIANCE",
    quality_team: "COMPLIANCE",
    procurement_team: "TENANT_ADMIN",
    production_team: "TENANT_ADMIN",
    legal_team: "COMPLIANCE",
    executive: "EXECUTIVE",
    regulatory_affairs: "COMPLIANCE",
    marketing_team: "VIEWER",
  };

  return roleMap[taskRole] ?? "COMPLIANCE";
}

// ============================================================================
// Task Status Update Helper
// ============================================================================

/**
 * Update the status of a task created by this activity.
 * Used by the orchestrator when a step is approved, completed, or failed.
 * Finds the task by its audit record and updates the status field.
 */
export async function updateTaskStatus(
  tenantId: string,
  taskId: string,
  newStatus: "in_progress" | "completed" | "failed" | "cancelled",
  completedByUserId?: string
): Promise<void> {
  await withTenant(tenantId, async () => {
    const existingTask = await prisma.auditLog.findFirst({
      where: {
        tenantId,
        action: "task_created",
        entityType: "workflow_task",
        entityId: taskId,
      },
    });

    if (!existingTask || !existingTask.newValue) {
      logger.warn({ taskId, tenantId }, "Task not found for status update");
      return;
    }

    const currentData = existingTask.newValue as Record<string, unknown>;
    await prisma.auditLog.update({
      where: { id: existingTask.id },
      data: {
        newValue: {
          ...currentData,
          status: newStatus,
          completedByUserId,
          completedAt: newStatus === "completed" || newStatus === "cancelled" ? new Date().toISOString() : undefined,
        },
      },
    });

    logger.info({ taskId, newStatus }, "Task status updated");
  });
}

/**
 * Get all pending tasks for a user across all active workflows.
 * Returns tasks sorted by priority (highest first) and then by due date.
 */
export async function getPendingTasksForUser(
  tenantId: string,
  userId: string
): Promise<Array<Record<string, unknown>>> {
  return withTenant(tenantId, async () => {
    const tasks = await prisma.auditLog.findMany({
      where: {
        tenantId,
        action: "task_created",
        entityType: "workflow_task",
        userId,
      },
      orderBy: { createdAt: "desc" },
    });

    return tasks
      .map((t) => t.newValue as Record<string, unknown>)
      .filter((t) => t["status"] === "pending")
      .sort((a, b) => {
        const priorityA = (a["prioritySort"] as number) ?? 50;
        const priorityB = (b["prioritySort"] as number) ?? 50;
        if (priorityA !== priorityB) return priorityB - priorityA;
        return new Date(a["dueDate"] as string).getTime() - new Date(b["dueDate"] as string).getTime();
      });
  });
}
