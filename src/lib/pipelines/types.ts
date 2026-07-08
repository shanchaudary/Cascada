// Cascada — Shared Pipeline Types
// Common type definitions for all data ingestion pipelines.
// Every pipeline client implements the same interface for consistency.

import type { SourceType, SourceStatus } from "@prisma/client";

// ============================================================================
// Pipeline identification
// ============================================================================
export type PipelineType = "legiscan" | "openfda" | "federal_register" | "usda";

export const PIPELINE_TYPES: readonly PipelineType[] = [
  "legiscan",
  "openfda",
  "federal_register",
  "usda",
] as const;

// ============================================================================
// Pipeline execution lifecycle
// ============================================================================
export type PipelineRunStatus = "running" | "completed" | "failed";
export type PipelineExecutionMode = "dry_run" | "write";
export type PipelineBoundedRunStatus = PipelineRunStatus | "blocked";

export const DEFAULT_PIPELINE_RUN_LIMIT = 10;
export const MAX_PIPELINE_RUN_LIMIT = 25;

export interface PipelineRunContext {
  runId: string;
  pipelineType: PipelineType;
  startedAt: Date;
  recordsProcessed: number;
  recordsNew: number;
  recordsUpdated: number;
  recordsFailed: number;
  errorDetail: string | null;
}

// ============================================================================
// Rate limiting
// ============================================================================
export interface RateLimitConfig {
  /** Maximum requests per interval */
  maxRequests: number;
  /** Interval duration in milliseconds */
  intervalMs: number;
}

export interface RateLimitState {
  /** Timestamps of recent requests within the current interval */
  requestTimestamps: number[];
  /** Number of requests currently in-flight */
  inFlight: number;
  /** Maximum concurrent requests allowed */
  maxConcurrent: number;
}

// ============================================================================
// Retry configuration
// ============================================================================
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds before first retry */
  baseDelayMs: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (typically 2) */
  backoffMultiplier: number;
  /** HTTP status codes that should be retried */
  retryableStatusCodes: number[];
  /** Whether to add jitter to retry delays */
  jitter: boolean;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  jitter: true,
};

// ============================================================================
// Pipeline fetch result
// ============================================================================
export interface PipelineFetchResult<T> {
  /** Raw records fetched from the external API */
  records: T[];
  /** Total number of records available from the API (may be more than fetched) */
  totalAvailable: number;
  /** Cursor or offset for the next page of results */
  nextCursor: string | null;
  /** Whether this is the last page of results */
  isLastPage: boolean;
  /** API-specific metadata (rate limit remaining, etc.) */
  metadata: Record<string, unknown>;
}

// ============================================================================
// Transformed record — ready for database persistence
// ============================================================================
export interface TransformedRegulatorySource {
  /** External ID from the source API (bill_id, document_number, etc.) */
  sourceId: string;
  /** Type of regulatory source */
  sourceType: SourceType;
  /** Jurisdiction code (US, US-CA, US-TX, etc.) */
  jurisdiction: string;
  /** Human-readable name */
  name: string;
  /** Source title, when distinct from display name */
  title?: string | null;
  /** Short source summary or description */
  summary?: string | null;
  /** URL to the source document */
  sourceUrl: string | null;
  /** Citation URL to preserve source evidence */
  citationUrl?: string | null;
  /** Current status of the source in our system */
  status: SourceStatus;
  /** Date the source was published, if known */
  publishedAt?: Date | null;
  /** Date Cascada observed/fetched this source */
  observedAt?: Date | null;
  /** Agency or source owner, if available */
  sourceAgency?: string | null;
  /** Source-specific document/category type */
  documentType?: string | null;
  /** Date the source was introduced/published */
  introducedDate: Date | null;
  /** Date the source was enacted/effective */
  enactedDate: Date | null;
  /** Date the source takes effect */
  effectiveDate: Date | null;
  /** Full text content of the source */
  fullText: string | null;
  /** Raw API response preserved for audit trail */
  rawApiResponse: Record<string, unknown>;
  /** Keywords/categories relevant to food manufacturing */
  relevantCategories: string[];
  /** Match metadata for auditability */
  matchMetadata?: Record<string, unknown> | null;
  /** Whether this record is likely relevant to food manufacturing */
  isRelevant: boolean;
}

// ============================================================================
// Pipeline deduplication check
// ============================================================================
export interface DeduplicationCheck {
  /** Whether this record already exists in our database */
  exists: boolean;
  /** If it exists, the ID of the existing RegulatorySource record */
  existingId: string | null;
  /** If it exists, whether the external data has changed since last fetch */
  hasChanged: boolean;
  /** Hash of the current raw API response for change detection */
  contentHash: string;
}

// ============================================================================
// Pipeline execution result
// ============================================================================
export interface PipelineExecutionResult {
  /** Pipeline type that was run */
  pipelineType: PipelineType;
  /** Duration of the entire pipeline run in milliseconds */
  durationMs: number;
  /** Number of records fetched from the external API */
  fetched: number;
  /** Number of new RegulatorySource records created */
  created: number;
  /** Number of existing RegulatorySource records updated */
  updated: number;
  /** Number of records that failed processing */
  failed: number;
  /** Number of records skipped (not relevant to food manufacturing) */
  skipped: number;
  /** Number of records that were duplicates (no changes) */
  duplicates: number;
  /** Detailed errors for failed records */
  errors: PipelineRecordError[];
  /** Run status */
  status: PipelineRunStatus;
}

export interface PipelineBoundedExecutionOptions {
  mode: PipelineExecutionMode;
  limit: number;
  cursor?: string | null;
}

export interface PipelinePreviewRecord {
  sourceId: string;
  sourceType: SourceType;
  name: string;
  jurisdiction: string;
  sourceUrl: string | null;
  status: SourceStatus;
  isRelevant: boolean;
  duplicate: boolean;
  changed: boolean;
}

export interface PipelineBoundedExecutionResult {
  pipelineType: PipelineType;
  sourceName: string;
  mode: PipelineExecutionMode;
  limit: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: PipelineBoundedRunStatus;
  recordsFetched: number;
  recordsTransformed: number;
  recordsWritten: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  dedupeHits: number;
  pipelineRunId: string | null;
  errors: PipelineRecordError[];
  previews: PipelinePreviewRecord[];
  blockedReason?: "not_configured";
  message?: string;
}

export interface PipelineRecordError {
  /** External source ID of the failed record */
  sourceId: string;
  /** Error that occurred during processing */
  error: string;
  /** Stage where the error occurred */
  stage: "fetch" | "transform" | "deduplicate" | "persist";
  /** Whether this error is retryable */
  retryable: boolean;
}

// ============================================================================
// Pipeline configuration per source
// ============================================================================
export interface PipelineSourceConfig {
  /** Unique pipeline identifier */
  type: PipelineType;
  /** Human-readable name */
  name: string;
  /** Base URL for the API */
  baseUrl: string;
  /** API key environment variable name */
  apiKeyEnvVar: string;
  /** Whether the API key is required (vs optional for higher rate limits) */
  apiKeyRequired: boolean;
  /** Rate limiting configuration */
  rateLimit: RateLimitConfig;
  /** Poll interval in minutes */
  pollIntervalMinutes: number;
  /** Maximum number of records to fetch per run (0 = unlimited) */
  maxRecordsPerRun: number;
  /** Search queries / filters to apply when fetching */
  defaultFilters: Record<string, string>;
  /** HTTP request timeout in milliseconds */
  requestTimeoutMs: number;
}

// ============================================================================
// Pipeline scheduling
// ============================================================================
export interface PipelineSchedule {
  /** Pipeline type */
  type: PipelineType;
  /** Whether this pipeline is enabled */
  enabled: boolean;
  /** Cron expression for scheduling (empty = manual only) */
  cronExpression: string;
  /** Minimum interval between runs in minutes */
  minIntervalMinutes: number;
  /** Last time this pipeline ran */
  lastRunAt: Date | null;
  /** Next scheduled run time */
  nextRunAt: Date | null;
  /** Current run status */
  currentStatus: "idle" | "running" | "error";
  /** Number of consecutive errors */
  consecutiveErrors: number;
}

// ============================================================================
// Pipeline client interface — every pipeline must implement this
// ============================================================================
export interface IPipelineClient<TRaw, TTransformed> {
  /** Pipeline identification */
  readonly pipelineType: PipelineType;
  readonly config: PipelineSourceConfig;

  /** Fetch records from the external API */
  fetch(cursor: string | null, limit: number): Promise<PipelineFetchResult<TRaw>>;

  /** Transform raw API records into our internal format */
  transform(raw: TRaw): TTransformed;

  /** Check if a record already exists in our database */
  deduplicate(transformed: TTransformed): Promise<DeduplicationCheck>;

  /** Persist a transformed record to the database */
  persist(transformed: TTransformed, dedup: DeduplicationCheck): Promise<string>;

  /** Execute the full pipeline: fetch → transform → deduplicate → persist */
  execute(cursor?: string | null): Promise<PipelineExecutionResult>;

  /** Execute a bounded dry-run or explicit write run */
  executeBounded(options: PipelineBoundedExecutionOptions): Promise<PipelineBoundedExecutionResult>;

  /** Validate that the pipeline can connect to its external API */
  healthCheck(): Promise<boolean>;
}

// ============================================================================
// HTTP request types
// ============================================================================
export interface PipelineRequestOptions {
  /** URL path (appended to base URL) */
  path: string;
  /** Query parameters */
  params?: Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>>;
  /** HTTP method */
  method?: "GET" | "POST";
  /** Request body (for POST) */
  body?: Record<string, unknown>;
  /** Additional headers */
  headers?: Record<string, string>;
  /** Request-specific timeout override */
  timeoutMs?: number;
}

export interface PipelineResponse<T> {
  /** Response data */
  data: T;
  /** HTTP status code */
  statusCode: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Rate limit info from response headers */
  rateLimit: {
    remaining: number | null;
    resetAt: Date | null;
    limit: number | null;
  };
}

// ============================================================================
// Food manufacturing relevance keywords
// These are used to filter pipeline results for relevance before processing.
// ============================================================================
export const FOOD_RELEVANCE_KEYWORDS: readonly string[] = [
  // Additives & ingredients
  "food additive",
  "food additive petition",
  "color additive",
  "generally recognized as safe",
  "GRAS",
  "substance",
  "ingredient",
  "additive",
  "preservative",
  "emulsifier",
  "stabilizer",
  "flavoring",
  "flavor enhancer",
  "sweetener",
  "colorant",
  "dye",
  "pigment",

  // Chemical substances
  "Red 3",
  "Red No. 3",
  "FD&C Red No. 3",
  "erythrosine",
  "titanium dioxide",
  "TiO2",
  "potassium bromate",
  "brominated vegetable oil",
  "BVO",
  "propylparaben",
  "butylparaben",
  "PFAS",
  "per- and polyfluoroalkyl",
  "forever chemicals",
  "lead",
  "cadmium",
  "arsenic",
  "mercury",
  "acrylamide",
  "4-MEI",
  "4-methylimidazole",

  // Food safety & regulation
  "food safety",
  "food manufacturing",
  "food processing",
  "food labeling",
  "food packaging",
  "food contact",
  "food contact substance",
  "food defense",
  "HACCP",
  "FSMA",
  "Food Safety Modernization Act",
  "FSVP",
  "preventive controls",

  // Specific regulatory areas
  "nutrition label",
  "nutrition facts",
  "allergen",
  "allergen labeling",
  "GMO",
  "genetically engineered",
  "bioengineered",
  "organic",
  "pesticide residue",
  "maximum residue limit",
  "MRL",
  "tolerance",
  "food adulteration",
  "contaminant",
  "heavy metal",

  // Specific food categories
  "infant formula",
  "dietary supplement",
  "functional food",
  "processed food",
  "confectionery",
  "bakery",
  "beverage",
  "dairy",
  "meat",
  "poultry",
  "seafood",
  "produce",

  // Regulatory actions
  "ban",
  "prohibit",
  "phase out",
  "phase-out",
  "warning label",
  "disclosure",
  "certification",
  "recall",
  "market withdrawal",
  "import alert",
  "detention",
  "enforcement",
  "compliance",
  "compliance date",

  // Retailer mandates
  "Walmart",
  "Target",
  "Kroger",
  "Costco",
  "Whole Foods",
  "Amazon Fresh",
  "retailer mandate",
  "supplier requirement",
  "clean label",
  "no artificial",
] as const;

// ============================================================================
// Jurisdiction mapping for state codes
// ============================================================================
export const STATE_CODE_TO_JURISDICTION: Readonly<Record<string, string>> = {
  AL: "US-AL",
  AK: "US-AK",
  AZ: "US-AZ",
  AR: "US-AR",
  CA: "US-CA",
  CO: "US-CO",
  CT: "US-CT",
  DE: "US-DE",
  FL: "US-FL",
  GA: "US-GA",
  HI: "US-HI",
  ID: "US-ID",
  IL: "US-IL",
  IN: "US-IN",
  IA: "US-IA",
  KS: "US-KS",
  KY: "US-KY",
  LA: "US-LA",
  ME: "US-ME",
  MD: "US-MD",
  MA: "US-MA",
  MI: "US-MI",
  MN: "US-MN",
  MS: "US-MS",
  MO: "US-MO",
  MT: "US-MT",
  NE: "US-NE",
  NV: "US-NV",
  NH: "US-NH",
  NJ: "US-NJ",
  NM: "US-NM",
  NY: "US-NY",
  NC: "US-NC",
  ND: "US-ND",
  OH: "US-OH",
  OK: "US-OK",
  OR: "US-OR",
  PA: "US-PA",
  RI: "US-RI",
  SC: "US-SC",
  SD: "US-SD",
  TN: "US-TN",
  TX: "US-TX",
  UT: "US-UT",
  VT: "US-VT",
  VA: "US-VA",
  WA: "US-WA",
  WV: "US-WV",
  WI: "US-WI",
  WY: "US-WY",
  DC: "US-DC",
} as const;

// ============================================================================
// LegiScan bill status codes
// ============================================================================
export const LEGISCAN_STATUS_MAP: Readonly<Record<number, string>> = {
  1: "introduced",
  2: "engrossed",
  3: "enrolled",
  4: "passed",
  5: "vetoed",
  6: "failed",
  7: "override",
  8: "chaptered",
  9: "refer to committee",
  10: "committee report",
  11: "floor vote",
  12: "signed by governor",
  13: "dead",
} as const;
