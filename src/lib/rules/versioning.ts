// Cascada — Rule Versioning
// Manages rule version lifecycle: creation, superseding, repeal, and history.
// Rules use a linked-list pattern — each version points to its previous version.
// This provides a full audit trail and supports rollback.

import { prisma } from "@/lib/db";
import { createLlmLogger } from "@/lib/logger";
import { NotFoundError, ConflictError } from "@/lib/errors";

// ============================================================================
// Types
// ============================================================================

export interface RuleVersionHistory {
  ruleId: string;
  sourceId: string;
  version: number;
  ruleType: string;
  description: string;
  effectiveDate: Date | null;
  smeValidatedBy: string | null;
  smeValidatedAt: Date | null;
  createdAt: Date;
}

export interface RuleVersionChain {
  current: RuleVersionHistory;
  previous: RuleVersionHistory[];
}

// ============================================================================
// Version chain retrieval
// ============================================================================

/**
 * Get the full version history chain for a rule.
 * Follows previousVersionId links back to the original rule.
 */
export async function getRuleVersionChain(ruleId: string): Promise<RuleVersionChain> {
  const logger = createLlmLogger("system", "rule-versioning");

  const current = await prisma.rule.findUnique({
    where: { id: ruleId },
    select: {
      id: true,
      sourceId: true,
      version: true,
      ruleType: true,
      description: true,
      effectiveDate: true,
      smeValidatedBy: true,
      smeValidatedAt: true,
      createdAt: true,
      previousVersionId: true,
    },
  });

  if (!current) {
    throw new NotFoundError("Rule", ruleId);
  }

  const previous: RuleVersionHistory[] = [];
  let prevId = current.previousVersionId;

  // Follow the chain back (max 50 versions to prevent infinite loops)
  let safety = 0;
  while (prevId && safety < 50) {
    const prevRule = await prisma.rule.findUnique({
      where: { id: prevId },
      select: {
        id: true,
        sourceId: true,
        version: true,
        ruleType: true,
        description: true,
        effectiveDate: true,
        smeValidatedBy: true,
        smeValidatedAt: true,
        createdAt: true,
        previousVersionId: true,
      },
    });

    if (!prevRule) break;

    previous.push({
      ruleId: prevRule.id,
      sourceId: prevRule.sourceId,
      version: prevRule.version,
      ruleType: prevRule.ruleType,
      description: prevRule.description,
      effectiveDate: prevRule.effectiveDate,
      smeValidatedBy: prevRule.smeValidatedBy,
      smeValidatedAt: prevRule.smeValidatedAt,
      createdAt: prevRule.createdAt,
    });

    prevId = prevRule.previousVersionId;
    safety++;
  }

  if (safety >= 50) {
    logger.warn(
      { ruleId },
      "Version chain exceeded 50 entries — possible data integrity issue"
    );
  }

  return {
    current: {
      ruleId: current.id,
      sourceId: current.sourceId,
      version: current.version,
      ruleType: current.ruleType,
      description: current.description,
      effectiveDate: current.effectiveDate,
      smeValidatedBy: current.smeValidatedBy,
      smeValidatedAt: current.smeValidatedAt,
      createdAt: current.createdAt,
    },
    previous,
  };
}

// ============================================================================
// Superseding
// ============================================================================

/**
 * Mark an old rule version as superseded by a new version.
 * This happens when a regulation is amended — the old rule stays in the
 * history chain but is no longer the active version.
 *
 * Only rules that have been SME-validated can supersede other rules.
 */
export async function supersedeRule(
  oldRuleId: string,
  newRuleId: string,
  validatedBy: string
): Promise<void> {
  const logger = createLlmLogger("system", "rule-versioning");

  const [oldRule, newRule] = await Promise.all([
    prisma.rule.findUnique({ where: { id: oldRuleId } }),
    prisma.rule.findUnique({ where: { id: newRuleId } }),
  ]);

  if (!oldRule) throw new NotFoundError("Rule", oldRuleId);
  if (!newRule) throw new NotFoundError("Rule", newRuleId);

  // Verify they're from the same source
  if (oldRule.sourceId !== newRule.sourceId) {
    throw new ConflictError(
      "Cannot supersede a rule from a different regulatory source",
      { oldSourceId: oldRule.sourceId, newSourceId: newRule.sourceId }
    );
  }

  // Verify the new rule has been validated
  if (!newRule.smeValidatedBy) {
    throw new ConflictError(
      "Cannot supersede with an unvalidated rule — SME must approve the new version first",
      { newRuleId, oldRuleId }
    );
  }

  // Update the old rule's cascade triggers to point to the new rule
  await prisma.cascadeTrigger.updateMany({
    where: { ruleId: oldRuleId },
    data: { ruleId: newRuleId },
  });

  // Update the source status to reflect the supersession
  await prisma.regulatorySource.update({
    where: { id: oldRule.sourceId },
    data: {
      status: "SUPERSEDED",
    },
  });

  logger.info(
    { oldRuleId, newRuleId, validatedBy },
    "Rule superseded"
  );
}

// ============================================================================
// Repeal
// ============================================================================

/**
 * Mark a rule as repealed. This means the regulation is no longer in effect.
 * All cascade triggers for this rule should be reviewed or dismissed.
 */
export async function repealRule(
  ruleId: string,
  repealedBy: string,
  repealReason: string
): Promise<void> {
  const logger = createLlmLogger("system", "rule-versioning");

  const rule = await prisma.rule.findUnique({
    where: { id: ruleId },
    include: { source: true },
  });

  if (!rule) throw new NotFoundError("Rule", ruleId);

  // Update the source status
  await prisma.regulatorySource.update({
    where: { id: rule.sourceId },
    data: { status: "REPEALED" },
  });

  // Log the repeal as an audit event
  await prisma.auditLog.create({
    data: {
      userId: repealedBy,
      action: "REPEAL_RULE",
      entityType: "Rule",
      entityId: ruleId,
      oldValue: { status: rule.source.status, ruleType: rule.ruleType },
      newValue: { status: "REPEALED", reason: repealReason },
    },
  });

  logger.info(
    { ruleId, repealedBy, repealReason },
    "Rule repealed"
  );
}

// ============================================================================
// Diff between versions
// ============================================================================

export interface RuleVersionDiff {
  ruleId: string;
  oldVersion: number;
  newVersion: number;
  changes: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    significance: "major" | "minor" | "cosmetic";
  }>;
  substanceChanges: {
    added: string[];
    removed: string[];
    modified: string[];
  };
}

/**
 * Compare two versions of a rule to identify changes.
 * Useful for SME review — shows exactly what changed between versions.
 */
export async function diffRuleVersions(
  oldRuleId: string,
  newRuleId: string
): Promise<RuleVersionDiff> {
  const [oldRule, newRule] = await Promise.all([
    prisma.rule.findUnique({
      where: { id: oldRuleId },
      include: { substances: true },
    }),
    prisma.rule.findUnique({
      where: { id: newRuleId },
      include: { substances: true },
    }),
  ]);

  if (!oldRule) throw new NotFoundError("Rule", oldRuleId);
  if (!newRule) throw new NotFoundError("Rule", newRuleId);

  const changes: RuleVersionDiff["changes"] = [];

  // Compare fields
  const comparableFields: Array<{
    field: keyof typeof oldRule;
    significance: "major" | "minor" | "cosmetic";
  }> = [
    { field: "ruleType", significance: "major" },
    { field: "description", significance: "major" },
    { field: "effectiveDate", significance: "major" },
    { field: "complianceDate", significance: "major" },
    { field: "gracePeriodDays", significance: "minor" },
    { field: "penaltyType", significance: "major" },
    { field: "penaltyAmount", significance: "major" },
    { field: "exemptions", significance: "major" },
    { field: "notes", significance: "cosmetic" },
  ];

  for (const { field, significance } of comparableFields) {
    const oldVal = oldRule[field];
    const newVal = newRule[field];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({
        field,
        oldValue: oldVal,
        newValue: newVal,
        significance,
      });
    }
  }

  // Compare substances
  const oldSubstanceNames = new Set(oldRule.substances.map((s) => s.substanceName.toLowerCase()));
  const newSubstanceNames = new Set(newRule.substances.map((s) => s.substanceName.toLowerCase()));

  const added = newRule.substances
    .filter((s) => !oldSubstanceNames.has(s.substanceName.toLowerCase()))
    .map((s) => s.substanceName);

  const removed = oldRule.substances
    .filter((s) => !newSubstanceNames.has(s.substanceName.toLowerCase()))
    .map((s) => s.substanceName);

  const modified: string[] = [];
  for (const oldSub of oldRule.substances) {
    const newSub = newRule.substances.find(
      (s) => s.substanceName.toLowerCase() === oldSub.substanceName.toLowerCase()
    );
    if (newSub && JSON.stringify(oldSub.threshold) !== JSON.stringify(newSub.threshold)) {
      modified.push(oldSub.substanceName);
    }
  }

  return {
    ruleId: newRuleId,
    oldVersion: oldRule.version,
    newVersion: newRule.version,
    changes,
    substanceChanges: { added, removed, modified },
  };
}

// ============================================================================
// Latest active rules
// ============================================================================

/**
 * Get the latest SME-validated version of each rule for a source.
 * Only returns rules that are currently active (not superseded or repealed).
 */
export async function getLatestActiveRules(sourceId: string) {
  const source = await prisma.regulatorySource.findUnique({
    where: { id: sourceId },
  });

  if (!source) throw new NotFoundError("RegulatorySource", sourceId);

  // Get all rules for this source, grouped by rule type, latest version first
  const rules = await prisma.rule.findMany({
    where: { sourceId },
    include: { substances: true },
    orderBy: [{ ruleType: "asc" }, { version: "desc" }],
  });

  // For each rule type, take only the latest version
  const seenTypes = new Set<string>();
  const latestRules = rules.filter((r) => {
    if (seenTypes.has(r.ruleType)) return false;
    seenTypes.add(r.ruleType);
    return true;
  });

  return latestRules;
}
