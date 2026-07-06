// Cascada — LegiScan Pipeline Types
// Type definitions specific to the LegiScan API.
// LegiScan tracks legislation across all 50 US states and Congress.
// API docs: https://legiscan.com/gaits/documentation/api

// ============================================================================
// LegiScan API operations
// ============================================================================
export type LegiScanOperation =
  | "search"
  | "getBill"
  | "getBillText"
  | "getMasterList"
  | "getSessionList"
  | "getSponsoredList"
  | "getAmendment"
  | "getSupplement"
  | "getPerson";

// ============================================================================
// LegiScan API response wrapper
// ============================================================================
export interface LegiScanApiResponse<T> {
  status: string; // "OK" or "ERROR"
  alert_id: number;
  params: Record<string, unknown>;
  cache_ts: number;
  timestamp: string;
  access_status: string;
  result: T;
}

// ============================================================================
// Search results
// ============================================================================
export interface LegiScanSearchParams {
  /** Search query string */
  query: string;
  /** Two-letter state code (e.g., "CA", "TX") or "ALL" for all states */
  state?: string;
  /** Bill number (e.g., "AB 418") */
  bill?: string;
  /** Session ID to limit search */
  session?: number;
  /** Year or year range (e.g., "2025" or "2023-2025") */
  year?: string;
  /** Page number for pagination */
  page?: number;
}

export interface LegiScanSearchResultItem {
  relevance: number;
  state: string;
  bill_number: string;
  bill_id: number;
  title: string;
  description: string;
}

export interface LegiScanSearchResults {
  summary: {
    page: number;
    count: number;
    per_page: number;
    total: number;
    page_count: number;
  };
  results: LegiScanSearchResultItem[];
}

// ============================================================================
// Master list (all bills in a session)
// ============================================================================
export interface LegiScanMasterListBill {
  bill_id: number;
  number: string;
  status_date: string;
  status: number;
  title: string;
  description: string;
}

export interface LegiScanMasterListResult {
  session_id: number;
  session_name: string;
  state: string;
  year_start: number;
  year_end: number;
  bills: Record<string, LegiScanMasterListBill>;
}

// ============================================================================
// Bill detail
// ============================================================================
export interface LegiScanBillDetail {
  bill_id: number;
  bill_number: string;
  bill_type: string;
  type: string;
  title: string;
  description: string;
  status: number;
  status_date: string;
  progress: Array<{
    date: string;
    event: number;
    event_description: string;
  }>;
  url: string;
  state_link: string;
  state: string;
  state_id: number;
  session_id: number;
  session: {
    session_id: number;
    session_name: string;
    session_title: string;
    year_start: number;
    year_end: number;
    special: number;
  };
  sponsors: Array<{
    people_id: number;
    name: string;
    party: string;
    role: number;
    district: string;
  }>;
  subjects: string[];
  texts: Array<{
    doc_id: number;
    date: string;
    type: string;
    mime: string;
    mime_id: number;
    url: string;
    state_link: string;
    size: number;
  }>;
  amendments: Array<{
    amendment_id: number;
    date: string;
    amendment_title: string;
    amendment_description: string;
  }>;
  votes: Array<{
    roll_call_id: number;
    date: string;
    desc: string;
   yea: number;
    nay: number;
    nv: number;
    absent: number;
    total: number;
    passed: number;
    chamber: string;
  }>;
  calendar: Array<{
    type: string;
    date: string;
    time: string;
    location: string;
    description: string;
  }>;
  history: Array<{
    date: string;
    action: string;
    chamber: string;
    importance: number;
  }>;
}

// ============================================================================
// Bill text
// ============================================================================
export interface LegiScanBillText {
  doc_id: number;
  date: string;
  type: string;
  mime: string;
  url: string;
  state_link: string;
  size: number;
  text: string; // The actual bill text content
}

// ============================================================================
// Session info
// ============================================================================
export interface LegiScanSession {
  session_id: number;
  state_id: number;
  session_name: string;
  session_title: string;
  year_start: number;
  year_end: number;
  special: number;
}

export interface LegiScanSessionList {
  state_id: number;
  state: string;
  sessions: LegiScanSession[];
}

// ============================================================================
// LegiScan bill status codes (complete mapping)
// ============================================================================
export const LEGISCAN_BILL_STATUS: Readonly<Record<number, string>> = {
  0: "any",
  1: "introduced",
  2: "engrossed",
  3: "enrolled",
  4: "passed",
  5: "vetoed",
  6: "failed",
  7: "veto override",
  8: "chaptered",
  9: "referred to committee",
  10: "committee report",
  11: "floor vote",
  12: "signed by governor",
  13: "dead",
} as const;

// ============================================================================
// LegiScan search queries for food manufacturing relevance
// These are the queries we run against LegiScan to find relevant legislation.
// Updated regularly to capture new regulatory trends.
// ============================================================================
export const LEGISCAN_FOOD_QUERIES: readonly string[] = [
  // Additive bans and restrictions
  "food additive ban",
  "food dye ban",
  "Red 3 ban",
  "FD&C Red",
  "titanium dioxide food",
  "potassium bromate",
  "brominated vegetable oil",
  "propylparaben food",
  "PFAS food packaging",
  "forever chemicals food",

  // Labeling requirements
  "food labeling requirement",
  "nutrition label",
  "allergen labeling",
  "GMO labeling",
  "bioengineered food",
  "clean label",

  // Safety and contamination
  "food safety regulation",
  "food contaminant",
  "heavy metal food",
  "lead food",
  "cadmium food",
  "arsenic food",
  "pesticide residue food",
  "maximum residue limit",

  // Processing and manufacturing
  "food processing regulation",
  "food manufacturing standard",
  "food contact substance",
  "food packaging regulation",
  "food additive petition",
  "GRAS food",

  // State-specific trends
  "California food",
  "New York food additive",
  "Texas food",
  "Washington state food",

  // Specific regulation types
  "food ban state",
  "food warning label",
  "food disclosure requirement",
  "food phase out",
  "food certification",

  // Dietary and nutritional
  "infant formula regulation",
  "dietary supplement regulation",
  "processed food regulation",
  "artificial sweetener regulation",
  "preservative ban",
] as const;
