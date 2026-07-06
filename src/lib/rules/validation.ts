// Cascada — SME Validation Workflow
// Subject Matter Expert (SME) validation of LLM-parsed rules.
// No rule enters the cascade engine without SME approval.
// This is the human-in-the-loop gate that ensures accuracy.

import { prisma } from "@/lib/db";
import { createLlmLogger } from "@/lib/logger";
import { NotFoundError, AuthorizationError, ConflictError } from "@/lib/errors";
import { diffRuleVersions } from "./versioning";

// ============================================================================
// Types
// ============================================================================

export interface SmeValidationInput {
  ruleId: string;
  validatorId: string;
  validatorRole: string;
  approved: boolean;
  notes?: string;
  corrections?: {
    description?: string;
    effectiveDate?: string | null;
    complianceDate?: string | null;
    penaltyType?: string | null;
    penaltyAmount?: number | null;
    substanceCorrections?: Array<{
      ruleSubstanceId: string;
      substanceName?: string;
      casNumber?: string | null;
      eenumber?: string | null;
      threshold?: number | null;
      thresholdUnit?: string | null;
    }>;
  };
}

export interface SmeValidationResult {
  ruleId: string;
  status: "SME_APPROVED" | "SME_REJECTED";
  validatedBy: string;
  validatedAt: Date;
  notes: string | null;
  correctionsApplied: number;
  sourceStatus: string;
}

export interface ValidationQueueItem {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  jurisdiction: string;
  ruleId: string;
  ruleType: string;
  ruleVersion: number;
  description: string;
  substanceCount: number;
  matchedCount: number;
  parsedAt: Date | null;
  confidence: number | null;
  previousVersionId: string | null;
}

// ============================================================================
// Validation queue
// ============================================================================

/**
 * Get all rules awaiting SME validation.
 * These are parsed rules with status PARSED that haven't been reviewed yet.
 */
export async function getValidationQueue(
  options: {
    jurisdiction?: string;
    sourceType?: string;
    limit?: number;
  } = {}
): Promise<ValidationQueueItem[]> {
  const { jurisdiction, sourceType, limit = 50 } = options;

  const sources = await prisma.regulatorySource.findMany({
    where: {
      status: "PARSED",
      ...(jurisdiction && { jurisdiction }),
      ...(sourceType && { sourceType: sourceType as import("@prisma/client").SourceType }),
    },
    include: {
      rules: {
        where: {
          smeValidatedBy: null, // Not yet validated
        },
        include: {
          substances: {
            where: { isMatched: true },
          },
        },
        orderBy: { version: "desc" },
      },
    },
    take: limit,
    orderBy: { createdAt: "desc" },
  });

  const queue: ValidationQueueItem[] = [];

  for (const source of sources) {
    for (const rule of source.rules) {
      queue.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.sourceType,
        jurisdiction: source.jurisdiction,
        ruleId: rule.id,
        ruleType: rule.ruleType,
        ruleVersion: rule.version,
        description: rule.description,
        substanceCount: rule.substances.length,
        matchedCount: rule.substances.length, // Only matched substances (isMatched: true)
        parsedAt: source.processedAt,
        confidence: rule.notes
          ? parseFloat(rule.notes.match(/Confidence:\s*([\d.]+)/)?.[1] ?? "0")
          : null,
        previousVersionId: rule.previousVersionId,
      });
    }
  }

  return queue;
}

// ============================================================================
// Validate a rule
// ============================================================================

/**
 * Validate (approve or reject) a rule as an SME.
 *
 * On approval:
 * - Rule is marked as SME_APPROVED
 * - Source status is updated to SME_APPROVED
 * - If corrections are provided, they are applied to the rule
 * - Audit log entry is created
 *
 * On rejection:
 * - Rule is marked as SME_REJECTED
 * - Source status is updated to SME_REJECTED
 * - Rejection reason is stored in notes
 * - The rule can be re-parsed with different LLM parameters
 */
export async function validateRule(
  input: SmeValidationInput
): Promise<SmeValidationResult> {
  const logger = createLlmLogger("system", "sme-validation");

  const rule = await prisma.rule.findUnique({
    where: { id: input.ruleId },
    include: { source: true, substances: true },
  });

  if (!rule) {
    throw new NotFoundError("Rule", input.ruleId);
  }

  // Check if already validated
  if (rule.smeValidatedBy) {
    throw new ConflictError(
      "Rule has already been validated",
      {
        ruleId: input.ruleId,
        validatedBy: rule.smeValidatedBy,
        validatedAt: rule.smeValidatedAt,
      }
    );
  }

  // Verify the validator has appropriate role
  const validRoles = ["SUPER_ADMIN", "TENANT_ADMIN", "COMPLIANCE"];
  if (!validRoles.includes(input.validatorRole)) {
    throw new AuthorizationError(
      "Only SUPER_ADMIN, TENANT_ADMIN, or COMPLIANCE users can validate rules",
      { validatorRole: input.validatorRole, validRoles }
    );
  }

  logger.info(
    {
      ruleId: input.ruleId,
      approved: input.approved,
      validatorId: input.validatorId,
      hasCorrections: !!input.corrections,
    },
    "SME validation started"
  );

  const now = new Date();
  let correctionsApplied = 0;

  if (input.approved) {
    // Apply corrections if provided
    if (input.corrections) {
      const updateData: Record<string, unknown> = {};
      if (input.corrections.description) {
        updateData["description"] = input.corrections.description;
        correctionsApplied++;
      }
      if (input.corrections.effectiveDate !== undefined) {
        updateData["effectiveDate"] = input.corrections.effectiveDate
          ? new Date(input.corrections.effectiveDate)
          : null;
        correctionsApplied++;
      }
      if (input.corrections.complianceDate !== undefined) {
        updateData["complianceDate"] = input.corrections.complianceDate
          ? new Date(input.corrections.complianceDate)
          : null;
        correctionsApplied++;
      }
      if (input.corrections.penaltyType !== undefined) {
        updateData["penaltyType"] = input.corrections.penaltyType;
        correctionsApplied++;
      }
      if (input.corrections.penaltyAmount !== undefined) {
        updateData["penaltyAmount"] = input.corrections.penaltyAmount;
        correctionsApplied++;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.rule.update({
          where: { id: input.ruleId },
          data: updateData,
        });
      }

      // Apply substance corrections
      if (input.corrections.substanceCorrections) {
        for (const subCorrection of input.corrections.substanceCorrections) {
          const subUpdate: Record<string, unknown> = {};
          if (subCorrection.substanceName) {
            subUpdate["substanceName"] = subCorrection.substanceName;
          }
          if (subCorrection.casNumber !== undefined) {
            subUpdate["casNumber"] = subCorrection.casNumber;
          }
          if (subCorrection.eenumber !== undefined) {
            subUpdate["eenumber"] = subCorrection.eenumber;
          }
          if (subCorrection.threshold !== undefined) {
            subUpdate["threshold"] = subCorrection.threshold;
          }
          if (subCorrection.thresholdUnit !== undefined) {
            subUpdate["thresholdUnit"] = subCorrection.thresholdUnit;
          }

          if (Object.keys(subUpdate).length > 0) {
            await prisma.ruleSubstance.update({
              where: { id: subCorrection.ruleSubstanceId },
              data: subUpdate,
            });
            correctionsApplied++;
          }
        }
      }
    }

    // Mark as approved
    await prisma.rule.update({
      where: { id: input.ruleId },
      data: {
        smeValidatedBy: input.validatorId,
        smeValidatedAt: now,
      },
    });

    // Update source status
    await prisma.regulatorySource.update({
      where: { id: rule.sourceId },
      data: { status: "SME_APPROVED" },
    });
  } else {
    // Mark as rejected
    await prisma.rule.update({
      where: { id: input.ruleId },
      data: {
        smeValidatedBy: input.validatorId,
        smeValidatedAt: now,
      },
    });

    // Update source status
    await prisma.regulatorySource.update({
      where: { id: rule.sourceId },
      data: { status: "SME_REJECTED" },
    });
  }

  // Create audit log
  await prisma.auditLog.create({
    data: {
      userId: input.validatorId,
      action: input.approved ? "SME_APPROVE_RULE" : "SME_REJECT_RULE",
      entityType: "Rule",
      entityId: input.ruleId,
      oldValue: { status: "PARSED", validatedBy: null },
      newValue: {
        status: input.approved ? "SME_APPROVED" : "SME_REJECTED",
        validatedBy: input.validatorId,
        notes: input.notes ?? null,
        correctionsApplied,
      },
    },
  });

  logger.info(
    {
      ruleId: input.ruleId,
      approved: input.approved,
      correctionsApplied,
    },
    "SME validation completed"
  );

  return {
    ruleId: input.ruleId,
    status: input.approved ? "SME_APPROVED" : "SME_REJECTED",
    validatedBy: input.validatorId,
    validatedAt: now,
    notes: input.notes ?? null,
    correctionsApplied,
    sourceStatus: input.approved ? "SME_APPROVED" : "SME_REJECTED",
  };
}

// ============================================================================
// Bulk validation
// ============================================================================

/**
 * Validate multiple rules at once.
 * Useful when an SME reviews an entire regulatory source.
 */
export async function bulkValidateRules(
  ruleIds: string[],
  validatorId: string,
  validatorRole: string,
  approved: boolean,
  notes?: string
): Promise<SmeValidationResult[]> {
  const results: SmeValidationResult[] = [];

  for (const ruleId of ruleIds) {
    try {
      const result = await validateRule({
        ruleId,
        validatorId,
        validatorRole,
        approved,
        notes,
      });
      results.push(result);
    } catch (error) {
      const logger = createLlmLogger("system", "sme-validation");
      logger.warn(
        { ruleId, error: error instanceof Error ? error.message : String(error) },
        "Bulk validation: individual rule failed"
      );
    }
  }

  return results;
}

// ============================================================================
// Validation statistics
// ============================================================================

export interface ValidationStats {
  totalParsed: number;
  pendingReview: number;
  approved: number;
  rejected: number;
  approvalRate: number;
  avgCorrectionsPerRule: number;
}

/**
 * Get validation statistics for the SME dashboard.
 */
export async function getValidationStats(): Promise<ValidationStats> {
  const [parsed, approved, rejected] = await Promise.all([
    prisma.rule.count({
      where: { smeValidatedBy: null },
    }),
    prisma.rule.count({
      where: { smeValidatedBy: { not: null } },
    }),
    prisma.rule.count({
      where: {
        source: { status: "SME_REJECTED" },
        smeValidatedBy: { not: null },
      },
    }),
  ]);

  const totalValidated = approved + rejected;
  const totalRules = parsed + totalValidated;

  return {
    totalParsed: totalRules,
    pendingReview: parsed,
    approved,
    rejected,
    approvalRate: totalValidated > 0 ? approved / totalValidated : 0,
    avgCorrectionsPerRule: 0, // Would need to track this in the audit log
  };
}
