import type { SourceType } from "@prisma/client";
import type { FederalRegisterDocument } from "./federal-register/types";
import type { OpenFdaFoodEnforcement } from "./openfda/types";
import type { UsdaFoodItem } from "./usda/types";

export type RelevanceConfidence = "high" | "medium" | "low";

export type RelevanceSourceCategory =
  | "federal_regulatory_document"
  | "food_enforcement"
  | "enrichment_reference"
  | "legislative_regulatory_document";

export interface RelevanceDecision {
  relevant: boolean;
  confidence: RelevanceConfidence;
  reasons: string[];
  excludedReasons: string[];
  matchedTerms: string[];
  excludedTerms: string[];
  sourceCategory: RelevanceSourceCategory;
}

interface WriteCandidate {
  sourceType: SourceType;
  isRelevant: boolean;
  relevanceDecision?: RelevanceDecision;
}

const FEDERAL_REGISTER_AGENCY_SLUGS = new Set([
  "food-and-drug-administration",
  "food-and-nutrition-service",
  "agricultural-marketing-service",
  "food-safety-and-inspection-service",
]);

const FEDERAL_REGISTER_INCLUDE_TERMS = [
  "food",
  "foods",
  "ingredient",
  "ingredients",
  "food additive",
  "color additive",
  "labeling",
  "nutrition",
  "allergen",
  "dietary supplement",
  "generally recognized as safe",
  "gras",
  "packaging",
  "food contact",
  "food contact substance",
  "contaminant",
  "residue",
  "recall",
  "adulteration",
  "food safety",
  "fsma",
  "infant formula",
  "pfas",
] as const;

const FEDERAL_REGISTER_EXCLUDE_TERMS = [
  "tobacco",
  "cigarette",
  "cigar",
  "nicotine",
  "vape",
  "vaping",
  "e-cigarette",
  "ends",
  "medical device",
  "device",
  "drug approval",
  "new drug",
  "biologics",
  "animal drug",
  "pharmaceutical",
  "opioid",
  "clinical trial",
] as const;

const OPENFDA_INCLUDE_TERMS = [
  "food",
  "dietary supplement",
  "allergen",
  "undeclared allergen",
  "contamination",
  "contaminated",
  "listeria",
  "salmonella",
  "e. coli",
  "foreign material",
  "mislabeling",
  "misbranded",
  "color additive",
  "ingredient",
  "nutrition",
  "infant formula",
  "undeclared",
] as const;

const OPENFDA_EXCLUDE_TERMS = [
  "device",
  "medical device",
  "drug",
  "cosmetic",
  "tobacco",
  "animal drug",
  "veterinary",
] as const;

const FOOD_CONTACT_EXCEPTION_TERMS = [
  "food contact",
  "food contact substance",
  "food packaging",
  "packaging",
] as const;

function normalizeText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(normalizeText).join(" ");
  }
  if (typeof value !== "string") return "";
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTerm(text: string, term: string): boolean {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;

  const pattern = escapeRegExp(normalizedTerm)
    .replace(/\\\s+/g, "\\s+")
    .replace(/-/g, "[-\\s]?");

  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(text);
}

function matchingTerms(text: string, terms: readonly string[]): string[] {
  return [...new Set(terms.filter((term) => hasTerm(text, term)))];
}

function federalDocumentText(doc: FederalRegisterDocument): string {
  return normalizeText([
    doc.title,
    doc.abstract,
    doc.action,
    doc.excerpts,
    doc.type,
    doc.topics ?? [],
    doc.subjects ?? [],
  ]);
}

function federalAgencySlugs(doc: FederalRegisterDocument): string[] {
  return (doc.agencies ?? [])
    .map((agency) => normalizeText(agency.slug ?? agency.name ?? agency.raw_name))
    .filter(Boolean);
}

function hasTrackedFederalAgency(slugs: string[]): boolean {
  return slugs.some((slug) => FEDERAL_REGISTER_AGENCY_SLUGS.has(slug));
}

function hasFoodContactException(matchedTerms: string[], excludedTerms: string[]): boolean {
  const hasDeviceExclusion = excludedTerms.some((term) => term.includes("device"));
  const hasFoodContactEvidence = matchedTerms.some((term) =>
    FOOD_CONTACT_EXCEPTION_TERMS.includes(term as (typeof FOOD_CONTACT_EXCEPTION_TERMS)[number]),
  );
  return hasDeviceExclusion && hasFoodContactEvidence;
}

function hardFederalExclusions(excludedTerms: string[], matchedTerms: string[]): string[] {
  if (hasFoodContactException(matchedTerms, excludedTerms)) {
    return excludedTerms.filter((term) => !term.includes("device"));
  }
  return excludedTerms;
}

export function evaluateFederalRegisterRelevance(doc: FederalRegisterDocument): RelevanceDecision {
  const text = federalDocumentText(doc);
  const slugs = federalAgencySlugs(doc);
  const matchedTerms = matchingTerms(text, FEDERAL_REGISTER_INCLUDE_TERMS);
  const excludedTerms = matchingTerms(text, FEDERAL_REGISTER_EXCLUDE_TERMS);
  const hardExclusions = hardFederalExclusions(excludedTerms, matchedTerms);
  const isFdaDocument = slugs.includes("food-and-drug-administration");
  const strongTerms = matchedTerms.filter((term) => term !== "food" && term !== "foods");
  const reasons: string[] = [];
  const excludedReasons: string[] = [];

  if (hasTrackedFederalAgency(slugs)) {
    reasons.push("Document is from a food-relevant Federal Register agency");
  } else {
    excludedReasons.push("Document agency is outside Cascada's food-relevant Federal Register set");
  }

  if (matchedTerms.length > 0) {
    reasons.push(`Matched food/manufacturing terms: ${matchedTerms.join(", ")}`);
  } else {
    excludedReasons.push("No food/manufacturing relevance terms matched");
  }

  if (isFdaDocument && strongTerms.length === 0) {
    excludedReasons.push("FDA records need specific food/manufacturing evidence beyond the word food");
  }

  if (excludedTerms.length > 0) {
    excludedReasons.push(`Matched non-target terms: ${excludedTerms.join(", ")}`);
  }

  if (hasFoodContactException(matchedTerms, excludedTerms)) {
    reasons.push("Medical-device language is retained only because food-contact evidence is present");
  }

  if (
    hardExclusions.length > 0 ||
    !hasTrackedFederalAgency(slugs) ||
    matchedTerms.length === 0 ||
    (isFdaDocument && strongTerms.length === 0)
  ) {
    return {
      relevant: false,
      confidence: "low",
      reasons,
      excludedReasons,
      matchedTerms,
      excludedTerms,
      sourceCategory: "federal_regulatory_document",
    };
  }

  const confidence: RelevanceConfidence =
    strongTerms.length >= 1 || matchedTerms.length >= 2 ? "high" : "medium";

  return {
    relevant: true,
    confidence,
    reasons,
    excludedReasons,
    matchedTerms,
    excludedTerms,
    sourceCategory: "federal_regulatory_document",
  };
}

export function evaluateOpenFdaEnforcementRelevance(
  record: OpenFdaFoodEnforcement,
): RelevanceDecision {
  const text = normalizeText([
    record.product_description,
    record.reason_for_recall,
    record.product_type,
    record.recalling_firm,
    record.classification,
  ]);
  const productType = normalizeText(record.product_type);
  const matchedTerms = matchingTerms(text, OPENFDA_INCLUDE_TERMS);
  const excludedTerms = matchingTerms(text, OPENFDA_EXCLUDE_TERMS);
  const isFoodEndpointRecord = hasTerm(productType, "food");
  const hasFoodEvidence = isFoodEndpointRecord || matchedTerms.length > 0;
  const hardExcluded = excludedTerms.length > 0 && !hasFoodEvidence;
  const reasons: string[] = [];
  const excludedReasons: string[] = [];

  if (isFoodEndpointRecord) {
    reasons.push("Record product_type identifies the official openFDA food enforcement endpoint");
  }

  if (matchedTerms.length > 0) {
    reasons.push(`Matched food enforcement terms: ${matchedTerms.join(", ")}`);
  } else {
    excludedReasons.push("No specific food enforcement terms matched");
  }

  if (excludedTerms.length > 0) {
    excludedReasons.push(`Matched non-target terms: ${excludedTerms.join(", ")}`);
  }

  if (hardExcluded || !hasFoodEvidence) {
    return {
      relevant: false,
      confidence: "low",
      reasons,
      excludedReasons,
      matchedTerms,
      excludedTerms,
      sourceCategory: "food_enforcement",
    };
  }

  return {
    relevant: true,
    confidence: matchedTerms.length > 0 ? "high" : "medium",
    reasons,
    excludedReasons,
    matchedTerms,
    excludedTerms,
    sourceCategory: "food_enforcement",
  };
}

export function evaluateUsdaReferenceRelevance(
  _item: UsdaFoodItem,
  matchedTerms: string[],
  isRelevant: boolean,
  reason: string,
): RelevanceDecision {
  return {
    relevant: isRelevant,
    confidence: isRelevant ? "medium" : "low",
    reasons: [
      "USDA FoodData Central is ingredient/product/nutrition reference data, not regulatory law",
      reason,
    ],
    excludedReasons: isRelevant
      ? ["Reference/enrichment records are not writeable to regulatory write mode"]
      : ["No USDA ingredient/reference relevance matched"],
    matchedTerms,
    excludedTerms: [],
    sourceCategory: "enrichment_reference",
  };
}

export function canWritePipelineRecord(candidate: WriteCandidate): boolean {
  const decision = candidate.relevanceDecision;

  if (!candidate.isRelevant) return false;
  if (candidate.sourceType === "REFERENCE_DATA") return false;
  if (!decision) return true;

  return (
    decision.relevant &&
    decision.confidence !== "low" &&
    decision.sourceCategory !== "enrichment_reference"
  );
}

export function writeReadinessReason(
  candidate: WriteCandidate,
  duplicate: boolean,
  changed: boolean,
): string {
  const decision = candidate.relevanceDecision;

  if (!candidate.isRelevant) return "Not writeable because the record is not relevant";
  if (candidate.sourceType === "REFERENCE_DATA") {
    return "Not writeable because the record is enrichment/reference data";
  }
  if (decision?.sourceCategory === "enrichment_reference") {
    return "Not writeable because the relevance category is enrichment/reference";
  }
  if (decision && !decision.relevant) return "Not writeable because relevance=false";
  if (decision?.confidence === "low") return "Not writeable because relevance confidence is low";
  if (duplicate && !changed) return "Not writeable because an unchanged duplicate already exists";
  return "Writeable after human review and explicit write-mode approval";
}
