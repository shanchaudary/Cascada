// Cascada — Federal Register Transforms
// Transform raw Federal Register API responses into Cascada's
// TransformedRegulatorySource format.
// Maps Federal Register documents (rules, proposed rules, notices)
// into our unified regulatory source model.

import type { TransformedRegulatorySource } from "../types";
import { FOOD_RELEVANCE_KEYWORDS } from "../types";
import type {
  FederalRegisterDocument,
  FederalRegisterAgency,
  FederalRegisterCanonicalDocumentType,
  FederalRegisterDocumentType,
} from "./types";
import { FR_DOC_TYPE_TO_SOURCE_TYPE } from "./types";
import type { SourceType, SourceStatus } from "@prisma/client";

// ============================================================================
// Date parsing
// ============================================================================
/**
 * Parse a Federal Register date string (YYYY-MM-DD format).
 */
export function parseFederalRegisterDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;

  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function normalizeFederalRegisterDocumentType(
  docType: FederalRegisterDocumentType,
): FederalRegisterCanonicalDocumentType {
  const normalizedType = docType.toUpperCase();

  if (normalizedType === "PROPOSED RULE") return "PROPOSED RULE";
  if (normalizedType === "PRESIDENTIAL DOCUMENT") return "PRESDOCU";
  if (normalizedType === "RULE") return "RULE";
  if (normalizedType === "NOTICE") return "NOTICE";
  if (normalizedType === "CORRECTION") return "CORRECTION";
  if (normalizedType === "PRORULE") return "PRORULE";

  return "NOTICE";
}

function agencySearchText(agency: FederalRegisterAgency): string {
  return [agency.short_name, agency.slug, agency.name, agency.raw_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function agencyDisplayName(agency: FederalRegisterAgency): string {
  return agency.short_name ?? agency.name ?? agency.slug ?? "Federal";
}

function documentUrl(doc: FederalRegisterDocument): string | null {
  return doc.html_url ?? doc.pdf_url ?? null;
}

/**
 * Map a Federal Register document type to our SourceType enum.
 * FDA rules map to FDA_RULE, proposed rules to FDA_PROPOSED_RULE, etc.
 */
export function mapDocumentTypeToSourceType(
  docType: FederalRegisterDocumentType,
  agencies: FederalRegisterAgency[] = [],
): SourceType {
  const canonicalType = normalizeFederalRegisterDocumentType(docType);

  // Check if this is from an FDA-related agency
  const isFda = agencies.some((agency) =>
    agencySearchText(agency).includes("food and drug") ||
    agencySearchText(agency).includes("fda")
  );

  if (isFda) {
    return FR_DOC_TYPE_TO_SOURCE_TYPE[canonicalType] ?? "FDA_RULE";
  }

  // Non-FDA federal documents
  if (canonicalType === "RULE" || canonicalType === "CORRECTION") {
    return "FEDERAL_REGISTER_NOTICE";
  }
  if (canonicalType === "PROPOSED RULE" || canonicalType === "PRORULE") {
    return "FDA_PROPOSED_RULE";
  }

  return "FEDERAL_REGISTER_NOTICE";
}

/**
 * Determine the SourceStatus based on the document type and effective date.
 * Rules with effective dates are ACTIVE, proposed rules need review.
 */
export function determineFederalRegisterStatus(
  docType: FederalRegisterDocumentType,
  effectiveDate: Date | null
): SourceStatus {
  switch (normalizeFederalRegisterDocumentType(docType)) {
    case "RULE":
    case "CORRECTION":
      // Final rules with effective dates are active
      return effectiveDate ? "ACTIVE" : "SME_REVIEW";
    case "PROPOSED RULE":
    case "PRORULE":
      // Proposed rules need processing
      return "DETECTED";
    case "NOTICE":
    case "PRESDOCU":
      // Notices are informational
      return "DETECTED";
    default:
      return "DETECTED";
  }
}

// ============================================================================
// Relevance checking
// ============================================================================
interface FrRelevanceResult {
  isRelevant: boolean;
  matchedCategories: string[];
  confidence: number;
}

/**
 * Check a Federal Register document for food manufacturing relevance.
 * Examines title, abstract, subjects, and agency information.
 */
function checkFederalRegisterRelevance(doc: FederalRegisterDocument): FrRelevanceResult {
  const agencies = doc.agencies ?? [];
  const subjects = doc.subjects ?? [];
  const topics = doc.topics ?? [];
  const textFields = [
    doc.title,
    doc.abstract,
    doc.action,
    ...subjects,
    ...topics,
    doc.excerpts ?? "",
  ].filter(Boolean);

  const combinedText = textFields.join(" ").toLowerCase();
  const matchedCategories: string[] = [];

  for (const keyword of FOOD_RELEVANCE_KEYWORDS) {
    if (combinedText.includes(keyword.toLowerCase())) {
      matchedCategories.push(keyword);
    }
  }

  // FDA documents are always potentially relevant
  const isFdaDoc = agencies.some(
    (agency) =>
      agencySearchText(agency).includes("food and drug") ||
      agencySearchText(agency).includes("fda")
  );

  // Food safety agency documents get a boost
  const isFoodSafetyDoc = agencies.some(
    (agency) =>
      agencySearchText(agency).includes("food safety") ||
      agencySearchText(agency).includes("agricultural marketing")
  );

  let confidence = 0;
  if (isFdaDoc && matchedCategories.length >= 2) confidence = 0.95;
  else if (isFdaDoc && matchedCategories.length >= 1) confidence = 0.9;
  else if (isFdaDoc) confidence = 0.7; // FDA docs even without keyword match
  else if (isFoodSafetyDoc && matchedCategories.length >= 1) confidence = 0.85;
  else if (matchedCategories.length >= 3) confidence = 0.8;
  else if (matchedCategories.length >= 2) confidence = 0.7;
  else if (matchedCategories.length >= 1) confidence = 0.6;

  return {
    isRelevant: confidence >= 0.5,
    matchedCategories,
    confidence,
  };
}

// ============================================================================
// Main transform
// ============================================================================

/**
 * Transform a Federal Register document into a TransformedRegulatorySource.
 * This is the primary transform for Federal Register pipeline records.
 */
export function transformFederalRegisterDocument(
  doc: FederalRegisterDocument
): TransformedRegulatorySource {
  const agencies = doc.agencies ?? [];
  const sourceType = mapDocumentTypeToSourceType(doc.type, agencies);
  const status = determineFederalRegisterStatus(doc.type, parseFederalRegisterDate(doc.effective_date));
  const relevance = checkFederalRegisterRelevance(doc);

  const name = buildDocumentName(doc);
  const fullText = buildFullText(doc);
  const publicationDate = parseFederalRegisterDate(doc.publication_date);
  const effectiveDate = parseFederalRegisterDate(doc.effective_date);

  // Determine introduced/enacted dates based on document type
  const canonicalType = normalizeFederalRegisterDocumentType(doc.type);
  const introducedDate = publicationDate;
  const enactedDate = canonicalType === "RULE" || canonicalType === "CORRECTION" ? effectiveDate : null;

  return {
    sourceId: doc.document_number,
    sourceType,
    jurisdiction: "US", // Federal Register is always federal
    name,
    title: doc.title,
    summary: doc.abstract ?? doc.excerpts ?? null,
    sourceUrl: documentUrl(doc),
    citationUrl: documentUrl(doc),
    status,
    publishedAt: publicationDate,
    observedAt: new Date(),
    sourceAgency: agencies.map(agencyDisplayName).join(", ") || null,
    documentType: normalizeFederalRegisterDocumentType(doc.type),
    introducedDate,
    enactedDate,
    effectiveDate,
    fullText,
    rawApiResponse: doc as unknown as Record<string, unknown>,
    relevantCategories: relevance.matchedCategories,
    matchMetadata: {
      source: "federal_register",
      confidence: relevance.confidence,
      agencies: agencies.map((agency) => agency.slug ?? agency.name ?? agency.raw_name),
      documentType: doc.type,
    },
    isRelevant: relevance.isRelevant,
  };
}

// ============================================================================
// Name builder
// ============================================================================
function buildDocumentName(doc: FederalRegisterDocument): string {
  const typeLabel = formatDocType(doc.type);
  const agencies = doc.agencies ?? [];
  const agencyShort = agencies.length > 0
    ? agencyDisplayName(agencies[0]!)
    : "Federal";

  // Format: "[Type] {Agency}: {Title}"
  return `${typeLabel} ${agencyShort}: ${doc.title}`;
}

function formatDocType(type: FederalRegisterDocumentType): string {
  switch (normalizeFederalRegisterDocumentType(type)) {
    case "RULE":
      return "Final Rule";
    case "PROPOSED RULE":
      return "Proposed Rule";
    case "NOTICE":
      return "Notice";
    case "PRESDOCU":
      return "Presidential Document";
    case "CORRECTION":
      return "Correction";
    case "PRORULE":
      return "Proposed Rule";
    default:
      return "Document";
  }
}

// ============================================================================
// Full text builder
// ============================================================================
function buildFullText(doc: FederalRegisterDocument): string {
  const sections: string[] = [];
  const agencies = doc.agencies ?? [];
  const subjects = doc.subjects ?? [];
  const topics = doc.topics ?? [];

  sections.push(`DOCUMENT NUMBER: ${doc.document_number}`);
  sections.push(`TYPE: ${formatDocType(doc.type)}`);
  sections.push(`TITLE: ${doc.title}`);
  sections.push(`PUBLICATION DATE: ${doc.publication_date ?? "Unknown"}`);

  if (doc.effective_date) {
    sections.push(`EFFECTIVE DATE: ${doc.effective_date}`);
  }
  if (doc.comments_close_on) {
    sections.push(`COMMENTS CLOSE: ${doc.comments_close_on}`);
  }

  if (doc.action) {
    sections.push("");
    sections.push(`ACTION: ${doc.action}`);
  }

  if (agencies.length > 0) {
    sections.push("");
    sections.push("AGENCIES:");
    for (const agency of agencies) {
      sections.push(`  - ${agency.name} (${agencyDisplayName(agency)})`);
    }
  }

  if (subjects.length > 0) {
    sections.push("");
    sections.push(`SUBJECTS: ${subjects.join(", ")}`);
  }

  if (topics.length > 0) {
    sections.push("");
    sections.push(`TOPICS: ${topics.join(", ")}`);
  }

  if (doc.abstract) {
    sections.push("");
    sections.push("ABSTRACT:");
    sections.push(doc.abstract);
  }

  // Include body text if available (truncated for storage)
  if (doc.body_text) {
    sections.push("");
    sections.push("FULL TEXT:");
    // Truncate body text to 500KB to prevent database bloat
    const maxBodyLength = 500_000;
    if (doc.body_text.length > maxBodyLength) {
      sections.push(doc.body_text.substring(0, maxBodyLength) + "\n... [truncated]");
    } else {
      sections.push(doc.body_text);
    }
  } else if (doc.excerpts) {
    sections.push("");
    sections.push("EXCERPTS:");
    sections.push(doc.excerpts);
  }

  if (doc.citation) {
    sections.push("");
    sections.push(`CITATION: ${doc.citation}`);
  }

  if (doc.significant) {
    sections.push("");
    sections.push("SIGNIFICANT: Yes");
  }

  if (doc.rin) {
    sections.push(`RIN: ${doc.rin}`);
  }

  return sections.join("\n");
}
