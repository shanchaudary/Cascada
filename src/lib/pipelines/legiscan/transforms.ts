// Cascada — LegiScan Transforms
// Transform raw LegiScan API responses into Cascada's TransformedRegulatorySource format.
// Handles jurisdiction mapping, status interpretation, and relevance scoring.

import type { TransformedRegulatorySource } from "../types";
import { STATE_CODE_TO_JURISDICTION, FOOD_RELEVANCE_KEYWORDS } from "../types";
import { LEGISCAN_BILL_STATUS } from "./types";
import type { LegiScanBillDetail, LegiScanSearchResultItem, LegiScanMasterListBill } from "./types";
import type { SourceType, SourceStatus } from "@prisma/client";

// ============================================================================
// Status mapping: LegiScan bill status → Cascada SourceStatus
// ============================================================================
const BILL_STATUS_TO_SOURCE_STATUS: Readonly<Record<number, SourceStatus>> = {
  0: "DETECTED",     // any
  1: "DETECTED",     // introduced
  2: "PARSED",       // engrossed — passed one chamber, likely to become law
  3: "SME_REVIEW",   // enrolled — passed both chambers, awaiting governor
  4: "SME_REVIEW",   // passed
  5: "DETECTED",     // vetoed
  6: "DETECTED",     // failed
  7: "SME_REVIEW",   // veto override
  8: "ACTIVE",       // chaptered — signed into law
  9: "DETECTED",     // referred to committee
  10: "DETECTED",    // committee report
  11: "DETECTED",    // floor vote
  12: "ACTIVE",      // signed by governor
  13: "DETECTED",    // dead
};

/**
 * Map a LegiScan bill status code to our SourceStatus enum.
 * Bills that have been signed into law or chaptered are marked ACTIVE.
 * Bills still in process are DETECTED (awaiting LLM parsing in Stage 3).
 */
export function mapBillStatusToSourceStatus(statusCode: number): SourceStatus {
  return BILL_STATUS_TO_SOURCE_STATUS[statusCode] ?? "DETECTED";
}

/**
 * Convert a two-letter state code to our jurisdiction format.
 * Returns "US" for federal bills, "US-{STATE}" for state bills.
 */
export function mapStateToJurisdiction(stateCode: string): string {
  if (stateCode === "US" || stateCode === "CONG") {
    return "US";
  }
  return STATE_CODE_TO_JURISDICTION[stateCode.toUpperCase()] ?? `US-${stateCode.toUpperCase()}`;
}

/**
 * Determine the SourceType based on the bill's state.
 * Federal bills get FEDERAL_BILL, state bills get STATE_BILL.
 */
export function determineSourceType(stateCode: string): SourceType {
  if (stateCode === "US" || stateCode === "CONG") {
    return "FEDERAL_BILL";
  }
  return "STATE_BILL";
}

/**
 * Parse a date string from LegiScan.
 * LegiScan uses various date formats including "YYYY-MM-DD" and timestamps.
 * Returns null if the date cannot be parsed.
 */
export function parseLegiScanDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;

  // Try ISO format first
  const isoDate = new Date(dateStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try timestamp (seconds since epoch)
  const timestamp = Number(dateStr);
  if (!isNaN(timestamp) && timestamp > 0) {
    // If it's in seconds (LegiScan sometimes uses Unix timestamps)
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    const tsDate = new Date(ms);
    if (!isNaN(tsDate.getTime())) {
      return tsDate;
    }
  }

  return null;
}

/**
 * Generate a descriptive name for a bill.
 * Format: "{State} {Bill Number}: {Title}"
 * Example: "CA AB 418: Food Safety Act"
 */
export function generateBillName(bill: LegiScanBillDetail | LegiScanSearchResultItem | LegiScanMasterListBill): string {
  const state = "state" in bill ? bill.state : "";
  const number = "bill_number" in bill ? bill.bill_number : ("number" in bill ? bill.number : "");
  const title = bill.title;

  if (state && number) {
    return `${state} ${number}: ${title}`;
  }
  return title;
}

// ============================================================================
// Main transform: LegiScan bill detail → TransformedRegulatorySource
// ============================================================================
export function transformBillDetail(bill: LegiScanBillDetail): TransformedRegulatorySource {
  const jurisdiction = mapStateToJurisdiction(bill.state);
  const sourceType = determineSourceType(bill.state);
  const status = mapBillStatusToSourceStatus(bill.status);
  const name = generateBillName(bill);

  // Build the full text from the bill description + history
  // The actual bill text is fetched separately via getBillText
  const fullText = buildFullText(bill);

  // Determine relevant dates from bill progress
  const introducedDate = extractIntroducedDate(bill);
  const enactedDate = extractEnactedDate(bill);
  const effectiveDate = extractEffectiveDate(bill);

  // Check relevance to food manufacturing
  const relevanceCheck = checkFoodRelevance(bill);

  return {
    sourceId: String(bill.bill_id),
    sourceType,
    jurisdiction,
    name,
    title: bill.title,
    summary: bill.description,
    sourceUrl: bill.url || bill.state_link || null,
    citationUrl: bill.url || bill.state_link || null,
    status,
    publishedAt: introducedDate,
    observedAt: new Date(),
    sourceAgency: bill.state,
    documentType: "legislation_bill",
    introducedDate,
    enactedDate,
    effectiveDate,
    fullText,
    rawApiResponse: bill as unknown as Record<string, unknown>,
    relevantCategories: relevanceCheck.matchedCategories,
    matchMetadata: {
      source: "legiscan",
      state: bill.state,
      billId: bill.bill_id,
      billNumber: bill.bill_number,
    },
    isRelevant: relevanceCheck.isRelevant,
  };
}

/**
 * Transform a search result item (lighter weight than full bill detail).
 * Used during initial scanning before fetching full bill details.
 */
export function transformSearchResult(result: LegiScanSearchResultItem): TransformedRegulatorySource {
  const jurisdiction = mapStateToJurisdiction(result.state);
  const sourceType = determineSourceType(result.state);
  const name = generateBillName(result);

  const relevanceCheck = checkSearchResultRelevance(result);

  return {
    sourceId: String(result.bill_id),
    sourceType,
    jurisdiction,
    name,
    title: result.title,
    summary: result.description,
    sourceUrl: null, // Will be populated when full bill is fetched
    citationUrl: null,
    status: "DETECTED",
    publishedAt: null,
    observedAt: new Date(),
    sourceAgency: result.state,
    documentType: "legislation_search_result",
    introducedDate: null,
    enactedDate: null,
    effectiveDate: null,
    fullText: `${result.title}\n\n${result.description}`,
    rawApiResponse: result as unknown as Record<string, unknown>,
    relevantCategories: relevanceCheck.matchedCategories,
    matchMetadata: {
      source: "legiscan",
      state: result.state,
      billId: result.bill_id,
      billNumber: result.bill_number,
    },
    isRelevant: relevanceCheck.isRelevant,
  };
}

/**
 * Transform a master list bill entry (minimal info).
 */
export function transformMasterListBill(
  bill: LegiScanMasterListBill,
  stateCode: string
): TransformedRegulatorySource {
  const jurisdiction = mapStateToJurisdiction(stateCode);
  const sourceType = determineSourceType(stateCode);
  const name = generateBillName(bill);
  const status = mapBillStatusToSourceStatus(bill.status);

  const relevanceCheck = checkMasterListRelevance(bill);

  return {
    sourceId: String(bill.bill_id),
    sourceType,
    jurisdiction,
    name,
    title: bill.title,
    summary: bill.description,
    sourceUrl: null,
    citationUrl: null,
    status,
    publishedAt: parseLegiScanDate(bill.status_date),
    observedAt: new Date(),
    sourceAgency: stateCode,
    documentType: "legislation_master_list",
    introducedDate: parseLegiScanDate(bill.status_date),
    enactedDate: null,
    effectiveDate: null,
    fullText: `${bill.title}\n\n${bill.description}`,
    rawApiResponse: bill as unknown as Record<string, unknown>,
    relevantCategories: relevanceCheck.matchedCategories,
    matchMetadata: {
      source: "legiscan",
      state: stateCode,
      billId: bill.bill_id,
      billNumber: "number" in bill ? bill.number : undefined,
    },
    isRelevant: relevanceCheck.isRelevant,
  };
}

// ============================================================================
// Relevance checking
// ============================================================================
interface RelevanceResult {
  isRelevant: boolean;
  matchedCategories: string[];
  confidence: number;
}

/**
 * Check a full bill detail for food manufacturing relevance.
 * Examines title, description, subjects, and sponsor history.
 */
function checkFoodRelevance(bill: LegiScanBillDetail): RelevanceResult {
  const textFields = [
    bill.title,
    bill.description,
    ...bill.subjects,
    ...bill.history.map((h) => h.action),
  ];

  const combinedText = textFields.join(" ").toLowerCase();
  const matchedCategories: string[] = [];

  for (const keyword of FOOD_RELEVANCE_KEYWORDS) {
    if (combinedText.includes(keyword.toLowerCase())) {
      matchedCategories.push(keyword);
    }
  }

  // Bills with "food" in the title are very likely relevant
  const titleHasFood = bill.title.toLowerCase().includes("food");
  // Bills about health/safety that mention substances are potentially relevant
  const titleHasHealth =
    bill.title.toLowerCase().includes("health") ||
    bill.title.toLowerCase().includes("safety");
  // Bills about consumer protection may be relevant
  const titleHasConsumer = bill.title.toLowerCase().includes("consumer");

  let confidence = 0;
  if (matchedCategories.length >= 3) confidence = 0.95;
  else if (matchedCategories.length >= 2) confidence = 0.85;
  else if (matchedCategories.length >= 1) confidence = 0.7;
  else if (titleHasFood) confidence = 0.6;
  else if (titleHasHealth && matchedCategories.length >= 1) confidence = 0.5;
  else if (titleHasConsumer && matchedCategories.length >= 1) confidence = 0.4;

  return {
    isRelevant: confidence >= 0.4,
    matchedCategories,
    confidence,
  };
}

/**
 * Check a search result for food manufacturing relevance.
 * Less information available than a full bill detail.
 */
function checkSearchResultRelevance(result: LegiScanSearchResultItem): RelevanceResult {
  const textFields = [result.title, result.description];
  const combinedText = textFields.join(" ").toLowerCase();
  const matchedCategories: string[] = [];

  for (const keyword of FOOD_RELEVANCE_KEYWORDS) {
    if (combinedText.includes(keyword.toLowerCase())) {
      matchedCategories.push(keyword);
    }
  }

  const isRelevant = matchedCategories.length > 0 ||
    combinedText.includes("food") ||
    combinedText.includes("additive") ||
    combinedText.includes("labeling");

  return {
    isRelevant,
    matchedCategories,
    confidence: matchedCategories.length >= 2 ? 0.9 : matchedCategories.length >= 1 ? 0.7 : 0.5,
  };
}

/**
 * Check a master list bill entry for relevance.
 * Minimal information — title and description only.
 */
function checkMasterListRelevance(bill: LegiScanMasterListBill): RelevanceResult {
  const textFields = [bill.title, bill.description];
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
    confidence: matchedCategories.length >= 1 ? 0.8 : 0.3,
  };
}

// ============================================================================
// Date extraction from bill progress
// ============================================================================
function extractIntroducedDate(bill: LegiScanBillDetail): Date | null {
  // The earliest history entry is typically the introduction date
  if (bill.history.length > 0) {
    const sortedHistory = [...bill.history].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    return parseLegiScanDate(sortedHistory[0]?.date ?? null);
  }
  return parseLegiScanDate(bill.status_date);
}

function extractEnactedDate(bill: LegiScanBillDetail): Date | null {
  // Look for signing or chaptering in the history
  const enactKeywords = ["signed", "chaptered", "enacted"];
  for (const entry of bill.history) {
    const actionLower = entry.action.toLowerCase();
    if (enactKeywords.some((kw) => actionLower.includes(kw))) {
      return parseLegiScanDate(entry.date);
    }
  }
  return null;
}

function extractEffectiveDate(bill: LegiScanBillDetail): Date | null {
  // Look for effective date mentions in the history or calendar
  const effectiveKeywords = ["effective", "takes effect", "becomes effective"];
  for (const entry of bill.history) {
    const actionLower = entry.action.toLowerCase();
    if (effectiveKeywords.some((kw) => actionLower.includes(kw))) {
      return parseLegiScanDate(entry.date);
    }
  }
  for (const cal of bill.calendar) {
    const descLower = cal.description.toLowerCase();
    if (effectiveKeywords.some((kw) => descLower.includes(kw))) {
      return parseLegiScanDate(cal.date);
    }
  }
  return null;
}

// ============================================================================
// Full text builder
// ============================================================================
function buildFullText(bill: LegiScanBillDetail): string {
  const sections: string[] = [];

  sections.push(`BILL: ${bill.bill_number}`);
  sections.push(`TITLE: ${bill.title}`);
  sections.push(`DESCRIPTION: ${bill.description}`);
  sections.push(`STATE: ${bill.state}`);
  sections.push(`STATUS: ${LEGISCAN_BILL_STATUS[bill.status] ?? "unknown"}`);
  sections.push(`STATUS DATE: ${bill.status_date}`);
  sections.push("");

  if (bill.sponsors.length > 0) {
    sections.push("SPONSORS:");
    for (const sponsor of bill.sponsors) {
      sections.push(`  - ${sponsor.name} (${sponsor.party}, District ${sponsor.district})`);
    }
    sections.push("");
  }

  if (bill.subjects.length > 0) {
    sections.push(`SUBJECTS: ${bill.subjects.join(", ")}`);
    sections.push("");
  }

  if (bill.history.length > 0) {
    sections.push("HISTORY:");
    const sortedHistory = [...bill.history].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    for (const entry of sortedHistory) {
      sections.push(`  [${entry.date}] ${entry.action} (${entry.chamber})`);
    }
    sections.push("");
  }

  return sections.join("\n");
}
