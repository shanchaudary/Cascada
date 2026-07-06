// Cascada — openFDA Pipeline Types
// Type definitions for the openFDA API.
// openFDA provides access to FDA public data including food enforcement reports,
// GRAS notices, and food facility registrations.
// API docs: https://open.fda.gov/apis/

// ============================================================================
// openFDA API response wrapper
// ============================================================================
export interface OpenFdaMeta {
  disclaimer: string;
  terms: string;
  license: string;
  last_updated: string;
  results: {
    skip: number;
    limit: number;
    total: number;
  };
}

export interface OpenFdaApiResponse<T> {
  meta: OpenFdaMeta;
  results: T[];
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Food Enforcement (Recalls)
// ============================================================================
export interface OpenFdaFoodEnforcement {
  country: string;
  city: string;
  address_1: string;
  address_2: string;
  state: string;
  zip: string;
  postal_code: string;
  product_quantity: string;
  code_info: string;
  product_description: string;
  reason_for_recall: string;
  recalling_firm: string;
  recall_number: string;
  initial_firm_notification: string;
  recall_initiation_date: string;
  report_date: string;
  classification: string;
  status: string;
  voluntary_mandated: string;
  distribution_pattern: string;
  recall_type: string;
  event_id: number;
  product_type: string;
  termination_date: string;
  more_code_info: string;
}

// ============================================================================
// GRAS Notices
// ============================================================================
export interface OpenFdaGrasNotice {
  gras_notice_number: string;
  subject: string;
  date_completed: string;
  date_of_submission: string;
  applicant: string;
  use: string;
  basis: string;
  food_source: string;
  regulation_number: string;
  citation: string;
  status: string;
}

// ============================================================================
// Food Facility Registration
// ============================================================================
export interface OpenFdaFoodFacility {
  registration_number: string;
  facility_name: string;
  facility_type: string;
  food_product_types: string;
  activities: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  owner_operator_name: string;
  owner_operator_type: string;
  date_created: string;
}

// ============================================================================
// Food Additive Petitions
// ============================================================================
export interface OpenFdaFoodAdditivePetition {
  fap_number: string;
  substance: string;
  use: string;
  petitioner: string;
  date_received: string;
  date_of_decision: string;
  decision: string;
  regulation_number: string;
  citation: string;
}

// ============================================================================
// Food Color Additives
// ============================================================================
export interface OpenFdaColorAdditive {
  id: string;
  color_additive_name: string;
  color_additive_uses: string;
  color_additive_status: string;
  date_introduced: string;
  citation: string;
  regulation_number: string;
}

// ============================================================================
// Search parameters
// ============================================================================
export interface OpenFdaSearchParams {
  /** Endpoint path (e.g., "food/enforcement", "food/gras") */
  endpoint: string;
  /** Search query string (Lucene syntax) */
  search?: string;
  /** Field to filter on */
  filter?: string;
  /** Number of results to return per page (max 100) */
  limit?: number;
  /** Number of results to skip (for pagination) */
  skip?: number;
  /** Sort field and direction (e.g., "report_date:desc") */
  sort?: string;
  /** Minimum date for date-range queries */
  minDate?: string;
  /** Maximum date for date-range queries */
  maxDate?: string;
}

// ============================================================================
// FDA food enforcement search queries
// Queries designed to catch recalls and enforcement actions relevant
// to food manufacturing regulation.
// ============================================================================
export const OPENFDA_ENFORCEMENT_QUERIES: readonly string[] = [
  // Additive and ingredient recalls
  'reason_for_recall:"food additive"',
  'reason_for_recall:"unapproved food additive"',
  'reason_for_recall:"undeclared"',
  'reason_for_recall:"allergen"',
  'reason_for_recall:"foreign material"',

  // Contamination
  'reason_for_recall:"contaminated"',
  'reason_for_recall:"lead"',
  'reason_for_recall:"salmonella"',
  'reason_for_recall:"listeria"',
  'reason_for_recall:"E. coli"',
  'reason_for_recall:"heavy metal"',

  // Labeling violations
  'reason_for_recall:"labeling"',
  'reason_for_recall:"misbranded"',
  'reason_for_recall:"false labeling"',
  'reason_for_recall:"nutrition labeling"',

  // Classification-based
  'classification:"Class I"',
  'classification:"Class II"',

  // Product-specific
  'product_type:"Food"',
] as const;

// ============================================================================
// FDA classification codes
// ============================================================================
export const FDA_CLASSIFICATION: Readonly<Record<string, string>> = {
  "Class I": "Dangerous or defective products that could cause serious health problems or death",
  "Class II": "Products that might cause a temporary health problem or pose a slight threat",
  "Class III": "Products that are unlikely to cause any adverse health reaction, but violate FDA regulations",
} as const;

// ============================================================================
// openFDA endpoint paths
// ============================================================================
export const OPENFDA_ENDPOINTS = {
  FOOD_ENFORCEMENT: "food/enforcement.json",
  FOOD_GRAS: "food/gras.json",
  FOOD_FACILITY: "food/registration.json",
  FOOD_ADDITIVE: "food/additive.json",
  FOOD_COLOR_ADDITIVE: "food/coloradditive.json",
} as const;

export type OpenFdaEndpoint = (typeof OPENFDA_ENDPOINTS)[keyof typeof OPENFDA_ENDPOINTS];
