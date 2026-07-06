// Cascada — Federal Register Pipeline Types
// Type definitions for the Federal Register API.
// The Federal Register is the official daily publication for rules,
// proposed rules, and notices of federal agencies.
// API docs: https://www.federalregister.gov/developers/documentation

// ============================================================================
// Federal Register API response
// ============================================================================
export interface FederalRegisterSearchResponse {
  count: number;
  description: string;
  total_pages: number;
  next_page_url: string | null;
  previous_page_url: string | null;
  results: FederalRegisterDocument[];
  facets?: Record<string, unknown>;
}

export interface FederalRegisterDocumentResponse {
  count: number;
  results: FederalRegisterDocument[];
}

// ============================================================================
// Document types
// ============================================================================
export interface FederalRegisterDocument {
  document_number: string;
  title: string;
  type: FederalRegisterDocumentType;
  abstract: string;
  publication_date: string;
  effective_date: string | null;
  action: string;
  agencies: FederalRegisterAgency[];
  topics: string[];
  subjects: string[];
  citation: string;
  html_url: string;
  pdf_url: string;
  full_text_xml_url: string | null;
  raw_text_url: string | null;
  body_html: string | null;
  body_text: string | null;
  excerpts: string | null;
  comments_close_on: string | null;
  significant: boolean;
  executive_order_number: string | null;
  regulatory_plan: boolean;
  rin: string | null;
  docket_id: string | null;
  docket_type: string | null;
  document_id: string;
  end_page: number | null;
  start_page: number | null;
  volume: number | null;
 _subtype: string | null;
  subtypes: string[];
  toc_doc: string | null;
  toc_subject: string | null;
  presidential_document_type: string | null;
  publication_date_override: string | null;
  filing_date_override: string | null;
}

export type FederalRegisterDocumentType =
  | "RULE"
  | "PROPOSED RULE"
  | "NOTICE"
  | "PRESDOCU"
  | "CORRECTION"
  | "PRORULE";

// ============================================================================
// Agency
// ============================================================================
export interface FederalRegisterAgency {
  name: string;
  short_name: string;
  url: string;
  json_url: string;
  parent_id: number | null;
  id: number;
}

// ============================================================================
// Search parameters
// ============================================================================
export interface FederalRegisterSearchParams {
  /** Document type filter */
  type?: FederalRegisterDocumentType[];
  /** Agency short names */
  agencies?: string[];
  /** Publication date range start (YYYY-MM-DD) */
  publication_date?: {
    gte?: string;
    lte?: string;
  };
  /** Effective date range */
  effective_date?: {
    gte?: string;
    lte?: string;
  };
  /** Search query */
  conditions?: {
    keyword?: string;
    full_text?: string;
    term?: string;
  };
  /** Sort order */
  order?: "newest" | "oldest" | "relevance" | "executive_order";
  /** Page number (1-indexed) */
  page?: number;
  /** Results per page (max 1000) */
  per_page?: number;
  /** Fields to include in response */
  fields?: string[];
}

// ============================================================================
// FDA-related agencies tracked by Cascada
// ============================================================================
export const FDA_RELATED_AGENCIES: readonly string[] = [
  "food-and-drug-administration",
  "food-safety-and-inspection-service",
  "animal-and-plant-health-inspection-service",
  "agricultural-marketing-service",
  "centers-for-disease-control-and-prevention",
  "national-institute-of-food-and-agriculture",
  "food-and-nutrition-service",
  "grain-inspection-packers-and-stockyards-administration",
] as const;

// ============================================================================
// Search conditions for food manufacturing
// ============================================================================
export const FEDERAL_REGISTER_FOOD_CONDITIONS: readonly FederalRegisterSearchParams[] = [
  // FDA food safety rules
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "food additive" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "food safety" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "food labeling" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "GRAS" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "food contact substance" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "color additive" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "food packaging" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "dietary supplement" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "allergen labeling" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "nutrition labeling" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-safety-and-inspection-service"],
    conditions: { keyword: "food safety" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "PFAS" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "contaminant" },
    order: "newest",
    per_page: 100,
  },
  {
    agencies: ["food-and-drug-administration"],
    conditions: { keyword: "infant formula" },
    order: "newest",
    per_page: 100,
  },
] as const;

// ============================================================================
// Document type to source type mapping
// ============================================================================
export const FR_DOC_TYPE_TO_SOURCE_TYPE: Readonly<
  Record<FederalRegisterDocumentType, "FDA_RULE" | "FDA_PROPOSED_RULE" | "FDA_GUIDANCE" | "FEDERAL_REGISTER_NOTICE">
> = {
  RULE: "FDA_RULE",
  "PROPOSED RULE": "FDA_PROPOSED_RULE",
  NOTICE: "FEDERAL_REGISTER_NOTICE",
  PRESDOCU: "FEDERAL_REGISTER_NOTICE",
  CORRECTION: "FDA_RULE",
  PRORULE: "FDA_PROPOSED_RULE",
} as const;
