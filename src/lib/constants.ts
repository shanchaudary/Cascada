// Cascada — Application Constants
// Single source of truth for business rules, pricing, limits, and configurations.

// ============================================================================
// Pricing (USD, annual)
// ============================================================================
export const PRICING = {
  DIAGNOSTIC_REPORT: 2500, // One-time paid diagnostic
  SCOUT: {
    annual: 36000,
    monthly: 3000,
    name: "Scout",
    features: [
      "Regulatory monitoring across 50 states",
      "Real-time alerts for relevant changes",
      "Basic exposure dashboard",
      "Email notifications",
    ],
  },
  PRO: {
    annual: 84000,
    monthly: 7000,
    name: "Pro",
    features: [
      "Everything in Scout",
      "Cascade impact analysis",
      "SKU-level exposure mapping",
      "Executive query agent",
      "Decision package generation",
      "Reformulation cost estimates",
    ],
  },
  COMMAND: {
    annual: 156000,
    monthly: 13000,
    name: "Command",
    features: [
      "Everything in Pro",
      "Workflow orchestration (Temporal)",
      "ERP integration (5 systems)",
      "Custom field mappings",
      "Dedicated support",
      "API access",
    ],
  },
} as const;

// ============================================================================
// Plan feature gates
// ============================================================================
export const PLAN_FEATURES = {
  DIAGNOSTIC: {
    maxUsers: 1,
    maxProducts: 0,
    maxErpConnections: 0,
    cascadeAnalysis: false,
    queryAgent: false,
    workflowOrchestration: false,
    apiAccess: false,
    diagnosticReport: true,
  },
  SCOUT: {
    maxUsers: 5,
    maxProducts: 500,
    maxErpConnections: 0,
    cascadeAnalysis: false,
    queryAgent: false,
    workflowOrchestration: false,
    apiAccess: false,
    diagnosticReport: true,
  },
  PRO: {
    maxUsers: 15,
    maxProducts: 5000,
    maxErpConnections: 2,
    cascadeAnalysis: true,
    queryAgent: true,
    workflowOrchestration: false,
    apiAccess: false,
    diagnosticReport: true,
  },
  COMMAND: {
    maxUsers: 50,
    maxProducts: Infinity,
    maxErpConnections: 5,
    cascadeAnalysis: true,
    queryAgent: true,
    workflowOrchestration: true,
    apiAccess: true,
    diagnosticReport: true,
  },
} as const;

// ============================================================================
// Regulatory jurisdictions tracked
// ============================================================================
export const JURISDICTIONS = {
  US_FEDERAL: "US",
  US_STATES: [
    "US-AL", "US-AK", "US-AZ", "US-AR", "US-CA", "US-CO", "US-CT", "US-DE",
    "US-FL", "US-GA", "US-HI", "US-ID", "US-IL", "US-IN", "US-IA", "US-KS",
    "US-KY", "US-LA", "US-ME", "US-MD", "US-MA", "US-MI", "US-MN", "US-MS",
    "US-MO", "US-MT", "US-NE", "US-NV", "US-NH", "US-NJ", "US-NM", "US-NY",
    "US-NC", "US-ND", "US-OH", "US-OK", "US-OR", "US-PA", "US-RI", "US-SC",
    "US-SD", "US-TN", "US-TX", "US-UT", "US-VT", "US-VA", "US-WA", "US-WV",
    "US-WI", "US-WY", "US-DC",
  ],
} as const;

// ============================================================================
// Pipeline configuration
// ============================================================================
export const PIPELINE_CONFIG = {
  LEGISCAN: {
    baseUrl: "https://api.legiscan.com/",
    rateLimitPerSecond: 2,
    pollIntervalMinutes: 60,
    maxRetries: 3,
    retryDelayMs: 5000,
  },
  OPENFDA: {
    baseUrl: "https://api.fda.gov/",
    rateLimitPerMinute: 240, // With API key
    pollIntervalMinutes: 30,
    maxRetries: 3,
    retryDelayMs: 3000,
  },
  FEDERAL_REGISTER: {
    baseUrl: "https://www.federalregister.gov/api/v1/",
    rateLimitPerHour: 1000,
    pollIntervalMinutes: 30,
    maxRetries: 3,
    retryDelayMs: 5000,
  },
  USDA: {
    baseUrl: "https://api.nal.usda.gov/fdc/v1/",
    rateLimitPerHour: 3600,
    pollIntervalMinutes: 1440, // Daily
    maxRetries: 3,
    retryDelayMs: 3000,
  },
} as const;

// ============================================================================
// Cascade engine configuration
// ============================================================================
export const CASCADE_CONFIG = {
  MAX_TRAVERSAL_DEPTH: 6, // Maximum hops in cascade traversal
  MIN_EDGE_STRENGTH: 0.1, // Edges below this strength are excluded
  RISK_WEIGHTS: {
    SEVERITY: 0.4,
    FINANCIAL_IMPACT: 0.3,
    TIMELINE_URGENCY: 0.2,
    BREATH: 0.1,
  },
  SEVERITY_DEADLINE_DAYS: {
    CRITICAL: 7,
    HIGH: 30,
    MEDIUM: 90,
    LOW: 180,
    INFO: 365,
  },
} as const;

// ============================================================================
// LLM configuration
// ============================================================================
export const LLM_CONFIG = {
  PRIMARY_MODEL: "gpt-4o",
  FALLBACK_MODEL: "claude-3-5-sonnet-20241022",
  COST_PER_TOKEN: {
    "gpt-4o": { prompt: 0.0000025, completion: 0.00001 },
    "gpt-4o-mini": { prompt: 0.00000015, completion: 0.0000006 },
    "claude-3-5-sonnet-20241022": { prompt: 0.000003, completion: 0.000015 },
  },
  MAX_RETRIES: 2,
  TIMEOUT_MS: 60000,
  TEMPERATURE: {
    RULE_PARSING: 0.0, // Deterministic for rule parsing
    QUERY_AGENT: 0.3, // Slightly creative for queries
    REFORMULATION: 0.5, // More creative for reformulation suggestions
  },
} as const;

// ============================================================================
// ERP sync configuration
// ============================================================================
export const ERP_SYNC_CONFIG = {
  FULL_SYNC_INTERVAL_HOURS: 24,
  INCREMENTAL_SYNC_INTERVAL_MINUTES: 15,
  MAX_CONCURRENT_SYNCS: 3,
  BATCH_SIZE: 100,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 10000,
  TIMEOUT_MS: 300000, // 5 minutes per entity sync
} as const;

// ============================================================================
// Application metadata
// ============================================================================
export const APP = {
  NAME: "Cascada",
  VERSION: "0.1.0",
  DESCRIPTION: "Food Manufacturing Regulatory Cascade Impact Analysis Platform",
  SUPPORT_EMAIL: "support@cascada.io",
  URL: process.env["APP_URL"] || "http://localhost:3000",
} as const;
