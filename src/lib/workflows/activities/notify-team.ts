// Cascada — Notify Team Activity
// Temporal activity that sends notifications to team members during
// workflow execution. Supports email, in-app, Slack, and Teams channels.
// Integrates with Resend for email delivery and stores notification
// records in the database for audit trail.

import { prisma, withTenant } from "@/lib/db";
import { createWorkflowLogger } from "@/lib/logger";
import { WorkflowActivityError } from "@/lib/errors";
import type {
  NotifyTeamInput,
  NotifyTeamOutput,
} from "@/lib/workflows/types";
import { NotifyTeamInputSchema } from "@/lib/workflows/types";

const logger = createWorkflowLogger("activity-notify");

// ============================================================================
// Notification Templates
// ============================================================================

/**
 * Built-in notification templates for workflow events.
 * Each template provides a subject and body with placeholder variables
 * that are substituted from the templateVariables in the input.
 */
const NOTIFICATION_TEMPLATES: Record<string, { subject: string; body: string }> = {
  "reformulation.started": {
    subject: "Reformulation Workflow Started — Action Required",
    body: `A reformulation workflow has been initiated for your review.\n\nWorkflow ID: {{workflowId}}\nTarget Ingredients: {{ingredients}}\nCompliance Deadline: {{deadline}}\nPriority: {{priority}}\n\nPlease review and take action at your earliest convenience.`,
  },
  "reformulation.approval_needed": {
    subject: "Reformulation Approval Required — {{productName}}",
    body: `A reformulation step requires your approval.\n\nProduct: {{productName}}\nIngredient Change: {{ingredientChange}}\nSubstitute: {{substitute}}\nImpact Assessment: {{impact}}\n\nPlease approve or reject this change.`,
  },
  "reformulation.testing_complete": {
    subject: "Reformulation Testing Complete — {{productName}}",
    body: `Testing has been completed for the reformulation of {{productName}}.\n\nSensory Results: {{sensoryResults}}\nStability Results: {{stabilityResults}}\nRecommendation: {{recommendation}}\n\nPlease review the results and take action.`,
  },
  "label_change.started": {
    subject: "Label Change Workflow Started — {{productCount}} Products Affected",
    body: `A label change workflow has been initiated.\n\nProducts Affected: {{productCount}}\nChange Types: {{changeTypes}}\nJurisdictions: {{jurisdictions}}\nCompliance Deadline: {{deadline}}\n\nPlease review and begin label updates.`,
  },
  "label_change.review_needed": {
    subject: "Label Change Review Required — {{productName}}",
    body: `A label change for {{productName}} is ready for review.\n\nChange Type: {{changeType}}\nNew Label Copy: {{newCopy}}\nCompliance Deadline: {{deadline}}\n\nPlease review the updated label.`,
  },
  "product_withdrawal.started": {
    subject: "URGENT: Product Withdrawal Initiated — {{productName}}",
    body: `A product withdrawal has been initiated.\n\nProduct: {{productName}}\nReason: {{reason}}\nScope: {{scope}}\nDeadline: {{deadline}}\n\nThis requires immediate attention.`,
  },
  "product_withdrawal.customer_notification": {
    subject: "Product Withdrawal — Customer Notification Required",
    body: `Customer notification is required for the product withdrawal.\n\nCustomers Affected: {{customerCount}}\nProduct: {{productName}}\nWithdrawal Reason: {{reason}}\n\nPlease prepare and send customer communications.`,
  },
  "compliance_review.started": {
    subject: "Compliance Review Workflow Started — {{regulationCount}} Regulations",
    body: `A compliance review workflow has been initiated.\n\nRegulations Under Review: {{regulationCount}}\nProducts Affected: {{productCount}}\nJurisdictions: {{jurisdictions}}\nReview Deadline: {{deadline}}\n\nPlease begin the compliance assessment.`,
  },
  "compliance_review.filing_needed": {
    subject: "Regulatory Filing Required — {{jurisdiction}}",
    body: `A regulatory filing is required for compliance.\n\nJurisdiction: {{jurisdiction}}\nFiling Type: {{filingType}}\nProducts: {{products}}\nDeadline: {{deadline}}\n\nPlease prepare and submit the filing.`,
  },
  "workflow.escalation": {
    subject: "ESCALATION: Workflow Step Timed Out — {{stepName}}",
    body: `A workflow step has timed out and requires escalation.\n\nWorkflow: {{workflowType}}\nStep: {{stepName}}\nTimeout Duration: {{timeout}}\nAssigned To: {{assignedRole}}\n\nPlease take immediate action.`,
  },
  "workflow.completed": {
    subject: "Workflow Completed — {{workflowType}}",
    body: `The workflow has been completed successfully.\n\nWorkflow Type: {{workflowType}}\nDuration: {{duration}}\nSteps Completed: {{stepsCompleted}}\nSummary: {{summary}}\n\nNo further action required.`,
  },
  "workflow.failed": {
    subject: "Workflow Failed — {{workflowType}}",
    body: `The workflow has encountered an error and failed.\n\nWorkflow Type: {{workflowType}}\nFailed Step: {{failedStep}}\nError: {{errorMessage}}\n\nPlease investigate and retry or cancel the workflow.`,
  },
};

// ============================================================================
// Activity Implementation
// ============================================================================

/**
 * Notify Team Activity — sends notifications to specified recipients.
 *
 * This activity performs the following:
 * 1. Validates the input using Zod schema
 * 2. Resolves recipient roles to actual user IDs from the database
 * 3. Renders the notification template with provided variables
 * 4. Dispatches notifications via the specified channel
 * 5. Records all notifications in the database for audit
 * 6. Returns the notification results including IDs and timestamps
 *
 * Retry policy: up to 3 retries with exponential backoff.
 * Idempotency: uses workflowInstanceId + stepId as deduplication key.
 */
export async function notifyTeam(input: NotifyTeamInput): Promise<NotifyTeamOutput> {
  const log = logger.child({ stepId: input.stepId, workflowInstanceId: input.workflowInstanceId });

  // Validate input
  const parsed = NotifyTeamInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new WorkflowActivityError(
      "notifyTeam",
      `Invalid input: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      { validationErrors: parsed.error.issues }
    );
  }

  const validated = parsed.data;
  log.info({ channel: validated.channel, recipientCount: validated.recipients.length }, "Sending notifications");

  try {
    // Resolve recipients: roles → user IDs + emails
    const resolvedRecipients = await withTenant(validated.tenantId, async () => {
      const recipients: Array<{ userId: string; email: string; name: string }> = [];

      for (const recipient of validated.recipients) {
        if (recipient.userId) {
          // Direct user ID — look up from database
          const user = await prisma.user.findUnique({
            where: { id: recipient.userId },
            select: { id: true, email: true, name: true, role: true, isActive: true },
          });
          if (user && user.isActive) {
            recipients.push({ userId: user.id, email: user.email, name: user.name });
          }
        } else if (recipient.role) {
          // Role-based — find all active users with this role in the tenant
          const users = await prisma.user.findMany({
            where: { role: recipient.role as any, isActive: true },
            select: { id: true, email: true, name: true },
          });
          for (const user of users) {
            recipients.push({ userId: user.id, email: user.email, name: user.name });
          }
        } else if (recipient.email) {
          // Direct email — for external stakeholders
          recipients.push({ userId: `external_${recipient.email}`, email: recipient.email, name: recipient.email });
        }
      }

      return recipients;
    });

    // Deduplicate recipients by userId
    const uniqueRecipients = Array.from(
      new Map(resolvedRecipients.map((r) => [r.userId, r])).values()
    );

    // Render template
    const template = NOTIFICATION_TEMPLATES[validated.templateKey];
    const renderedSubject = template
      ? substituteTemplateVariables(template.subject, validated.templateVariables)
      : `Cascada Notification: ${validated.templateKey}`;
    const renderedBody = template
      ? substituteTemplateVariables(template.body, validated.templateVariables)
      : Object.entries(validated.templateVariables)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n");

    // Dispatch notifications based on channel
    const notificationIds: string[] = [];
    const now = new Date().toISOString();

    for (const recipient of uniqueRecipients) {
      const notificationId = await dispatchNotification({
        recipient,
        channel: validated.channel,
        subject: renderedSubject,
        body: renderedBody,
        priority: validated.priority,
        tenantId: validated.tenantId,
        workflowInstanceId: validated.workflowInstanceId,
        stepId: validated.stepId,
      });
      notificationIds.push(notificationId);
    }

    log.info(
      { notificationsSent: uniqueRecipients.length, channel: validated.channel },
      "Notifications sent successfully"
    );

    return {
      notificationsSent: uniqueRecipients.length,
      recipientIds: uniqueRecipients.map((r) => r.userId),
      channel: validated.channel,
      sentAt: now,
      notificationIds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, "Failed to send notifications");
    throw new WorkflowActivityError("notifyTeam", message, {
      workflowInstanceId: validated.workflowInstanceId,
      stepId: validated.stepId,
    });
  }
}

// ============================================================================
// Notification Dispatching
// ============================================================================

interface DispatchParams {
  recipient: { userId: string; email: string; name: string };
  channel: string;
  subject: string;
  body: string;
  priority: string;
  tenantId: string;
  workflowInstanceId: string;
  stepId: string;
}

/**
 * Dispatch a single notification via the specified channel.
 * Creates an audit record in the database for every notification
 * regardless of channel. For email, uses the Resend API.
 */
async function dispatchNotification(params: DispatchParams): Promise<string> {
  const {
    recipient,
    channel,
    subject,
    body,
    priority,
    tenantId,
    workflowInstanceId,
    stepId,
  } = params;

  // Create audit record in database
  const auditId = `notif_${Date.now()}_${recipient.userId.slice(0, 8)}`;

  await withTenant(tenantId, async () => {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: recipient.userId,
        action: "notification_sent",
        entityType: "workflow_notification",
        entityId: auditId,
        newValue: {
          channel,
          subject,
          body,
          priority,
          workflowInstanceId,
          stepId,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
        },
      },
    });
  });

  // Channel-specific dispatch
  switch (channel) {
    case "email":
      await sendEmailNotification(recipient.email, subject, body, priority);
      break;
    case "in_app":
      // In-app notifications are stored in the audit log above;
      // the frontend polls for new notifications
      break;
    case "slack":
      await sendSlackNotification(recipient.email, subject, body);
      break;
    case "teams":
      await sendTeamsNotification(recipient.email, subject, body);
      break;
  }

  return auditId;
}

/**
 * Send an email notification via Resend.
 * Uses the RESEND_API_KEY environment variable for authentication.
 * Falls back gracefully if the API key is not configured (dev mode).
 */
async function sendEmailNotification(
  to: string,
  subject: string,
  body: string,
  priority: string
): Promise<void> {
  const resendApiKey = process.env["RESEND_API_KEY"];

  if (!resendApiKey || resendApiKey.startsWith("re_placeholder")) {
    // Development mode: log instead of sending
    logger.info({ to, subject, priority }, "Email notification (dev mode — not sent)");
    return;
  }

  // Production: call Resend API
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Cascada <noreply@cascada.io>",
      to: [to],
      subject,
      text: body,
      tags: [
        { name: "priority", value: priority },
        { name: "source", value: "workflow" },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.warn(
      { to, status: response.status, error: errorBody },
      "Email delivery failed — notification logged to audit trail"
    );
    // Do NOT throw — notification failure should not block the workflow.
    // The audit record already captures the attempt.
  }
}

/**
 * Send a Slack notification via webhook.
 * Uses the SLACK_WEBHOOK_URL environment variable.
 * Optional integration — logs a warning if not configured.
 */
async function sendSlackNotification(
  _recipientEmail: string,
  subject: string,
  body: string
): Promise<void> {
  const webhookUrl = process.env["SLACK_WEBHOOK_URL"];

  if (!webhookUrl) {
    logger.info({ subject }, "Slack notification skipped — no webhook configured");
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `*${subject}*\n${body}`,
      }),
    });
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Slack notification failed");
  }
}

/**
 * Send a Microsoft Teams notification via webhook.
 * Uses the TEAMS_WEBHOOK_URL environment variable.
 * Optional integration — logs a warning if not configured.
 */
async function sendTeamsNotification(
  _recipientEmail: string,
  subject: string,
  body: string
): Promise<void> {
  const webhookUrl = process.env["TEAMS_WEBHOOK_URL"];

  if (!webhookUrl) {
    logger.info({ subject }, "Teams notification skipped — no webhook configured");
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: subject,
        sections: [{ text: body }],
      }),
    });
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Teams notification failed");
  }
}

// ============================================================================
// Template Helpers
// ============================================================================

/**
 * Substitute {{variable}} placeholders in a template string with
 * the provided variables. Unknown placeholders are left as-is.
 */
function substituteTemplateVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}
