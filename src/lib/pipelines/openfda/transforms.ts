// Cascada — openFDA Transforms
// Transform raw openFDA API responses into Cascada's TransformedRegulatorySource format.
// Maps FDA enforcement actions, GRAS notices, and additive petitions
// into our unified regulatory source model.

import type { TransformedRegulatorySource } from "../types";
import { FOOD_RELEVANCE_KEYWORDS } from "../types";
import type {
  OpenFdaFoodEnforcement,
  OpenFdaGrasNotice,
  OpenFdaFoodAdditivePetition,
  OpenFdaColorAdditive,
} from "./types";
import type { SourceType, SourceStatus } from "@prisma/client";

// ============================================================================
// Date parsing
// ============================================================================
/**
 * Parse openFDA date format (YYYYMMDD) into a Date object.
 * openFDA uses this compact format for most date fields.
 */
export function parseOpenFdaDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || dateStr.length < 8) return null;

  // Format: YYYYMMDD
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);

  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Determine the US jurisdiction from a state code in an FDA record.
 * Most FDA records are federal (US), but recall records have state info.
 */
export function determineFdaJurisdiction(stateCode?: string): string {
  if (!stateCode || stateCode.length !== 2) return "US";
  return `US-${stateCode.toUpperCase()}`;
}

/**
 * Determine the SourceType for an FDA record based on its endpoint.
 */
export function determineFdaSourceType(
  recordType: "enforcement" | "gras" | "additive" | "color_additive"
): SourceType {
  switch (recordType) {
    case "enforcement":
      return "FDA_RULE";
    case "gras":
      return "FDA_GUIDANCE";
    case "additive":
      return "FDA_RULE";
    case "color_additive":
      return "FDA_RULE";
    default:
      return "FDA_RULE";
  }
}

/**
 * Determine SourceStatus for an FDA enforcement record.
 * Class I recalls are CRITICAL, active recalls need review.
 */
export function determineEnforcementStatus(record: OpenFdaFoodEnforcement): SourceStatus {
  // If the recall is terminated, it's ACTIVE (already processed)
  if (record.status?.toLowerCase().includes("terminated")) {
    return "ACTIVE";
  }
  // If it's ongoing, it needs processing
  if (record.status?.toLowerCase().includes("ongoing")) {
    return "DETECTED";
  }
  // Class I recalls are urgent
  if (record.classification === "Class I") {
    return "DETECTED";
  }
  return "DETECTED";
}

// ============================================================================
// Relevance checking
// ============================================================================
interface FdaRelevanceResult {
  isRelevant: boolean;
  matchedCategories: string[];
  confidence: number;
}

/**
 * Check an enforcement record for food manufacturing relevance.
 * Since these are already from the food endpoint, most are relevant.
 * We still filter to focus on manufacturing-impacting events.
 */
function checkEnforcementRelevance(record: OpenFdaFoodEnforcement): FdaRelevanceResult {
  const textFields = [
    record.product_description,
    record.reason_for_recall,
    record.product_type,
    record.recalling_firm,
  ].filter(Boolean);

  const combinedText = textFields.join(" ").toLowerCase();
  const matchedCategories: string[] = [];

  for (const keyword of FOOD_RELEVANCE_KEYWORDS) {
    if (combinedText.includes(keyword.toLowerCase())) {
      matchedCategories.push(keyword);
    }
  }

  // All food enforcement records are potentially relevant
  // but we boost confidence for matches
  const isRelevant = true; // Food enforcement is always relevant to food manufacturers
  const confidence = matchedCategories.length >= 2 ? 0.95 :
    matchedCategories.length >= 1 ? 0.85 : 0.7;

  return { isRelevant, matchedCategories, confidence };
}

/**
 * Check a GRAS notice for relevance.
 * GRAS notices are relevant when they involve substances
 * that food manufacturers use.
 */
function checkGrasRelevance(record: OpenFdaGrasNotice): FdaRelevanceResult {
  const textFields = [
    record.subject,
    record.use,
    record.food_source,
    record.applicant,
  ].filter(Boolean);

  const combinedText = textFields.join(" ").toLowerCase();
  const matchedCategories: string[] = [];

  for (const keyword of FOOD_RELEVANCE_KEYWORDS) {
    if (combinedText.includes(keyword.toLowerCase())) {
      matchedCategories.push(keyword);
    }
  }

  return {
    isRelevant: matchedCategories.length > 0 || combinedText.includes("food"),
    matchedCategories,
    confidence: matchedCategories.length >= 1 ? 0.9 : 0.6,
  };
}

// ============================================================================
// Main transforms
// ============================================================================

/**
 * Transform an FDA food enforcement (recall) record.
 * These records indicate active recall events that may signal
 * regulatory action affecting food manufacturers.
 */
export function transformEnforcementRecord(record: OpenFdaFoodEnforcement): TransformedRegulatorySource {
  const jurisdiction = determineFdaJurisdiction(record.state);
  const sourceType: SourceType = "FDA_RULE";
  const status = determineEnforcementStatus(record);
  const relevance = checkEnforcementRelevance(record);

  const name = `FDA Recall ${record.recall_number}: ${truncateString(record.product_description, 150)}`;
  const fullText = buildEnforcementFullText(record);
  const recallDate = parseOpenFdaDate(record.recall_initiation_date);

  return {
    sourceId: record.recall_number,
    sourceType,
    jurisdiction,
    name,
    sourceUrl: null,
    status,
    introducedDate: recallDate,
    enactedDate: null,
    effectiveDate: recallDate,
    fullText,
    rawApiResponse: record as unknown as Record<string, unknown>,
    relevantCategories: relevance.matchedCategories,
    isRelevant: relevance.isRelevant,
  };
}

/**
 * Transform a GRAS (Generally Recognized As Safe) notice.
 * GRAS notices affect food manufacturers when new substances are approved
 * or when existing GRAS status is challenged.
 */
export function transformGrasNotice(record: OpenFdaGrasNotice): TransformedRegulatorySource {
  const jurisdiction = "US";
  const sourceType: SourceType = "FDA_GUIDANCE";
  const relevance = checkGrasRelevance(record);

  const name = `GRAS Notice ${record.gras_notice_number}: ${truncateString(record.subject, 150)}`;
  const fullText = buildGrasFullText(record);
  const dateCompleted = parseOpenFdaDate(record.date_completed);
  const dateSubmitted = parseOpenFdaDate(record.date_of_submission);

  return {
    sourceId: `GRAS-${record.gras_notice_number}`,
    sourceType,
    jurisdiction,
    name,
    sourceUrl: null,
    status: "DETECTED",
    introducedDate: dateSubmitted,
    enactedDate: dateCompleted,
    effectiveDate: dateCompleted,
    fullText,
    rawApiResponse: record as unknown as Record<string, unknown>,
    relevantCategories: relevance.matchedCategories,
    isRelevant: relevance.isRelevant,
  };
}

/**
 * Transform an FDA food additive petition record.
 * Additive petitions affect manufacturers when new additives are approved
 * or existing ones have their conditions of use changed.
 */
export function transformAdditivePetition(record: OpenFdaFoodAdditivePetition): TransformedRegulatorySource {
  const jurisdiction = "US";
  const sourceType: SourceType = "FDA_RULE";

  const name = `Food Additive Petition ${record.fap_number}: ${truncateString(record.substance, 150)}`;
  const fullText = buildAdditiveFullText(record);
  const dateReceived = parseOpenFdaDate(record.date_received);
  const dateDecision = parseOpenFdaDate(record.date_of_decision);

  return {
    sourceId: `FAP-${record.fap_number}`,
    sourceType,
    jurisdiction,
    name,
    sourceUrl: null,
    status: "DETECTED",
    introducedDate: dateReceived,
    enactedDate: dateDecision,
    effectiveDate: dateDecision,
    fullText,
    rawApiResponse: record as unknown as Record<string, unknown>,
    relevantCategories: record.substance ? [record.substance] : [],
    isRelevant: true, // All additive petitions are relevant
  };
}

/**
 * Transform an FDA color additive record.
 * Color additives are heavily regulated and changes affect many food products.
 */
export function transformColorAdditive(record: OpenFdaColorAdditive): TransformedRegulatorySource {
  const jurisdiction = "US";
  const sourceType: SourceType = "FDA_RULE";

  const name = `Color Additive: ${record.color_additive_name}`;
  const fullText = buildColorAdditiveFullText(record);
  const dateIntroduced = parseOpenFdaDate(record.date_introduced);

  return {
    sourceId: `COLOR-${record.id}`,
    sourceType,
    jurisdiction,
    name,
    sourceUrl: null,
    status: "ACTIVE", // Color additive listings are already in effect
    introducedDate: dateIntroduced,
    enactedDate: null,
    effectiveDate: null,
    fullText,
    rawApiResponse: record as unknown as Record<string, unknown>,
    relevantCategories: [record.color_additive_name],
    isRelevant: true, // All color additive records are relevant
  };
}

// ============================================================================
// Full text builders
// ============================================================================
function buildEnforcementFullText(record: OpenFdaFoodEnforcement): string {
  const sections: string[] = [];

  sections.push(`RECALL NUMBER: ${record.recall_number}`);
  sections.push(`CLASSIFICATION: ${record.classification}`);
  sections.push(`STATUS: ${record.status}`);
  sections.push(`RECALL TYPE: ${record.voluntary_mandated}`);
  sections.push("");
  sections.push(`PRODUCT DESCRIPTION: ${record.product_description}`);
  sections.push(`PRODUCT QUANTITY: ${record.product_quantity}`);
  sections.push(`CODE INFO: ${record.code_info}`);
  sections.push(`PRODUCT TYPE: ${record.product_type}`);
  sections.push("");
  sections.push(`REASON FOR RECALL: ${record.reason_for_recall}`);
  sections.push("");
  sections.push(`RECALLING FIRM: ${record.recalling_firm}`);
  sections.push(`LOCATION: ${record.city}, ${record.state} ${record.zip}`);
  sections.push(`COUNTRY: ${record.country}`);
  sections.push("");
  sections.push(`DISTRIBUTION: ${record.distribution_pattern}`);
  sections.push(`INITIATION DATE: ${record.recall_initiation_date}`);
  sections.push(`REPORT DATE: ${record.report_date}`);
  if (record.termination_date) {
    sections.push(`TERMINATION DATE: ${record.termination_date}`);
  }
  sections.push(`INITIAL NOTIFICATION: ${record.initial_firm_notification}`);

  return sections.join("\n");
}

function buildGrasFullText(record: OpenFdaGrasNotice): string {
  const sections: string[] = [];

  sections.push(`GRAS NOTICE NUMBER: ${record.gras_notice_number}`);
  sections.push(`SUBJECT: ${record.subject}`);
  sections.push(`APPLICANT: ${record.applicant}`);
  sections.push(`DATE SUBMITTED: ${record.date_of_submission}`);
  sections.push(`DATE COMPLETED: ${record.date_completed}`);
  sections.push("");
  sections.push(`INTENDED USE: ${record.use}`);
  sections.push(`BASIS FOR GRAS: ${record.basis}`);
  sections.push(`FOOD SOURCE: ${record.food_source}`);
  sections.push(`STATUS: ${record.status}`);

  if (record.regulation_number) {
    sections.push(`REGULATION: ${record.regulation_number}`);
  }
  if (record.citation) {
    sections.push(`CITATION: ${record.citation}`);
  }

  return sections.join("\n");
}

function buildAdditiveFullText(record: OpenFdaFoodAdditivePetition): string {
  const sections: string[] = [];

  sections.push(`PETITION NUMBER: ${record.fap_number}`);
  sections.push(`SUBSTANCE: ${record.substance}`);
  sections.push(`PETITIONER: ${record.petitioner}`);
  sections.push(`DATE RECEIVED: ${record.date_received}`);
  sections.push(`DATE OF DECISION: ${record.date_of_decision}`);
  sections.push(`DECISION: ${record.decision}`);
  sections.push(`INTENDED USE: ${record.use}`);

  if (record.regulation_number) {
    sections.push(`REGULATION: ${record.regulation_number}`);
  }
  if (record.citation) {
    sections.push(`CITATION: ${record.citation}`);
  }

  return sections.join("\n");
}

function buildColorAdditiveFullText(record: OpenFdaColorAdditive): string {
  const sections: string[] = [];

  sections.push(`COLOR ADDITIVE: ${record.color_additive_name}`);
  sections.push(`USES: ${record.color_additive_uses}`);
  sections.push(`STATUS: ${record.color_additive_status}`);
  sections.push(`DATE INTRODUCED: ${record.date_introduced}`);

  if (record.regulation_number) {
    sections.push(`REGULATION: ${record.regulation_number}`);
  }
  if (record.citation) {
    sections.push(`CITATION: ${record.citation}`);
  }

  return sections.join("\n");
}

// ============================================================================
// Utility
// ============================================================================
function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}
