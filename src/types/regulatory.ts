// Cascada — Regulatory Type Definitions
// Types for regulatory sources, rules, substances, and parsing.

import type { SourceType, SourceStatus, RuleType } from "@prisma/client";

// ============================================================================
// LegiScan types
// ============================================================================
export interface LegiScanBill {
  bill_id: number;
  bill_number: string;
  bill_type: string;
  title: string;
  description: string;
  status: number;
  status_date: string;
  state: string;
  session_id: number;
  session_name: string;
  url: string;
  text_url: string;
  sponsors: Array<{
    people_id: number;
    name: string;
    party: string;
    role: number;
    district: string;
  }>;
  history: Array<{
    date: string;
    action: string;
    chamber: string;
  }>;
  subjects: string[];
  texts: Array<{
    doc_id: number;
    date: string;
    type: string;
    mime: string;
    url: string;
    state_link: string;
    size: number;
  }>;
}

export interface LegiScanSearchResult {
  summary: {
    count: number;
    page: number;
    per_page: number;
    total: number;
  };
  results: Array<{
    relevance: number;
    state: string;
    bill_number: string;
    title: string;
    bill_id: number;
  }>;
}

export interface LegiScanMasterList {
  session_id: number;
  session_name: string;
  state: string;
  year_start: number;
  year_end: number;
  bills: Record<string, {
    bill_id: number;
    number: string;
    status_date: string;
    status: number;
    title: string;
    description: string;
  }>;
}

// ============================================================================
// openFDA types
// ============================================================================
export interface OpenFdaFoodRecall {
  recall_number: string;
  recall_initiation_date: string;
  recall_posting_date: string;
  product_description: string;
  product_quantity: string;
  product_type: string;
  reason_for_recall: string;
  recalling_firm: string;
  classification: string;
  status: string;
  code_info: string;
  distribution_pattern: string;
  state: string;
  city: string;
  country: string;
  voluntary_mandated: string;
  initial_firm_notification: string;
}

export interface OpenFdaResponse<T> {
  meta: {
    last_updated: string;
    results: {
      skip: number;
      limit: number;
      total: number;
    };
  };
  results: T[];
}

export interface OpenFdaGrasNotice {
  gras_notice_number: string;
  substance: string;
  use: string;
  basis: string;
  date_completed: string;
  applicant: string;
}

// ============================================================================
// Federal Register types
// ============================================================================
export interface FederalRegisterDocument {
  document_number: string;
  title: string;
  type: string;
  abstract: string;
  publication_date: string;
  effective_date: string | null;
  agencies: Array<{
    name: string;
    short_name: string;
    url: string;
  }>;
  topics: string[];
  citation: string;
  html_url: string;
  pdf_url: string;
  comments_close_on: string | null;
  full_text_xml_url: string | null;
  body_html: string | null;
  significant: boolean;
  executive_order_number: string | null;
  regulatory_plan: boolean;
  rin: string | null;
}

export interface FederalRegisterSearchResult {
  count: number;
  next_page_url: string | null;
  previous_page_url: string | null;
  results: FederalRegisterDocument[];
}

// ============================================================================
// USDA FoodData Central types
// ============================================================================
export interface UsdaFood {
  fdcId: number;
  description: string;
  dataType: string;
  publicationDate: string;
  foodCategory: string;
  foodNutrients: Array<{
    nutrientId: number;
    nutrientName: string;
    unitName: string;
    amount: number;
  }>;
  foodComponents: Array<{
    number: number;
    name: string;
    percentWeight: number;
    isRefuse: boolean;
    gramWeight: number;
    dataPoints: number;
    minYearAcquired: number;
  }>;
  ingredients: string | null;
  brandOwner: string | null;
  gtinUpc: string | null;
}

export interface UsdaSearchResult {
  totalHits: number;
  currentPage: number;
  totalPages: number;
  foodSearchCriteria: string;
  foods: UsdaFood[];
}

// ============================================================================
// Rule parsing types (LLM output)
// ============================================================================
export interface ParsedRule {
  sourceId: string;
  jurisdiction: string;
  ruleType: RuleType;
  description: string;
  effectiveDate: string | null;
  complianceDate: string | null;
  gracePeriodDays: number | null;
  penaltyType: string | null;
  penaltyAmount: number | null;
  exemptions: ParsedExemption[];
  substances: ParsedSubstance[];
}

export interface ParsedSubstance {
  substanceName: string;
  substanceType: "specific_chemical" | "chemical_class" | "functional_category";
  casNumber: string | null;
  eenumber: string | null;
  threshold: number | null;
  thresholdUnit: string | null;
  productScope: string[] | null;
}

export interface ParsedExemption {
  description: string;
  productCategories: string[];
  conditions: string[];
}

// ============================================================================
// Substance matching types
// ============================================================================
export interface SubstanceMatch {
  ruleSubstanceId: string;
  ingredientId: string | null;
  confidence: number; // 0-1
  method: "exact" | "alias" | "cas_number" | "eenumber" | "llm_inferred" | "manual";
  reasoning: string;
}

export interface SubstanceMatchResult {
  totalSubstances: number;
  matched: number;
  unmatched: number;
  lowConfidence: number; // confidence < 0.7
  matches: SubstanceMatch[];
  unmatchedSubstances: Array<{
    substanceName: string;
    casNumber: string | null;
    eenumber: string | null;
  }>;
}
