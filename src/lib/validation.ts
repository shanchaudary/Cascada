// Cascada — Shared Zod Validation Schemas
// Runtime type validation for all API inputs.
// No endpoint accepts unvalidated data.

import { z } from "zod";

// ============================================================================
// Common primitives
// ============================================================================
export const cuidSchema = z.string().regex(/^c[a-z0-9]{24,}$/, "Invalid CUID format");

export const emailSchema = z.string().email("Invalid email format").toLowerCase().trim();

export const slugSchema = z
  .string()
  .min(2, "Slug must be at least 2 characters")
  .max(63, "Slug must be at most 63 characters")
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lowercase alphanumeric with hyphens");

export const percentageSchema = z.number().min(0).max(100);

export const decimalPositiveSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Must be a valid decimal number")
  .transform(Number);

// ============================================================================
// Auth schemas
// ============================================================================
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const registerSchema = z.object({
  email: emailSchema,
  name: z.string().min(2, "Name must be at least 2 characters").max(200),
  password: z.string().min(12, "Password must be at least 12 characters"),
  companyName: z.string().min(2, "Company name must be at least 2 characters").max(200),
  companySlug: slugSchema,
});

// ============================================================================
// Tenant schemas
// ============================================================================
export const tenantUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  plan: z.enum(["DIAGNOSTIC", "SCOUT", "PRO", "COMMAND"]).optional(),
});

export const userCreateSchema = z.object({
  email: emailSchema,
  name: z.string().min(2).max(200),
  role: z.enum(["TENANT_ADMIN", "COMPLIANCE", "EXECUTIVE", "VIEWER"]),
});

export const userUpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  role: z.enum(["TENANT_ADMIN", "COMPLIANCE", "EXECUTIVE", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================================
// ERP Connection schemas
// ============================================================================
export const erpConnectionCreateSchema = z.object({
  erpType: z.enum(["NETSUITE", "SAP_B1", "DYNAMICS_365_BC", "INFOR_M3", "EPICOR_P21"]),
  connectionName: z.string().min(2).max(200),
  connectionString: z.string().min(1, "Connection string is required"),
  authConfig: z.record(z.unknown()),
  fieldMappings: z.record(z.unknown()).optional(),
});

export const erpConnectionUpdateSchema = z.object({
  connectionName: z.string().min(2).max(200).optional(),
  connectionString: z.string().min(1).optional(),
  authConfig: z.record(z.unknown()).optional(),
  fieldMappings: z.record(z.unknown()).optional(),
});

// ============================================================================
// Ingredient schemas
// ============================================================================
export const ingredientCreateSchema = z.object({
  erpId: z.string().optional(),
  name: z.string().min(1).max(500),
  alternateNames: z.array(z.string()).default([]),
  casNumber: z.string().optional(),
  eenumber: z.string().optional(),
  category: z.enum([
    "dye", "preservative", "flavor", "emulsifier", "stabilizer",
    "sweetener", "antioxidant", "humectant", "leavening_agent",
    "thickener", "acid", "color", "nutrient", "other"
  ]).optional(),
  isSynthetic: z.boolean().optional(),
  sourceType: z.enum(["petroleum", "plant", "animal", "mineral", "synthetic"]).optional(),
  allergenFlags: z.array(z.string()).default([]),
  supplierIds: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export const ingredientUpdateSchema = ingredientCreateSchema.partial();

// ============================================================================
// Formulation schemas
// ============================================================================
export const formulationCreateSchema = z.object({
  erpId: z.string().optional(),
  name: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  batchSize: z.number().positive().optional(),
  batchSizeUnit: z.string().optional(),
});

export const formulationItemCreateSchema = z.object({
  ingredientId: cuidSchema,
  quantity: z.string().regex(/^\d+(\.\d+)?$/).transform(Number),
  unit: z.enum(["kg", "g", "mg", "L", "mL", "%", "oz", "lb"]),
  percentage: z.number().min(0).max(100).optional(),
  isAlternate: z.boolean().default(false),
  replacesIngredientId: cuidSchema.optional(),
  sortOrder: z.number().int().min(0),
});

// ============================================================================
// Product schemas
// ============================================================================
export const productCreateSchema = z.object({
  erpId: z.string().optional(),
  name: z.string().min(1).max(500),
  sku: z.string().min(1).max(100),
  category: z.string().max(200).optional(),
  brand: z.string().max(200).optional(),
  markets: z.array(z.string()).default([]),
  retailers: z.array(z.string()).default([]),
  annualVolume: z.number().positive().optional(),
  annualRevenue: z.number().positive().optional(),
});

export const productUpdateSchema = productCreateSchema.partial();

// ============================================================================
// Regulatory schemas
// ============================================================================
export const regulatorySourceProcessSchema = z.object({
  forceReprocess: z.boolean().default(false),
  enrichSubstances: z.boolean().default(true),
});

export const regulatorySourceValidateSchema = z.object({
  approved: z.boolean(),
  notes: z.string().max(5000).optional(),
  corrections: z.object({
    description: z.string().max(5000).optional(),
    effectiveDate: z.string().nullable().optional(),
    complianceDate: z.string().nullable().optional(),
    penaltyType: z.enum(["civil", "criminal", "product_ban", "fine_per_violation"]).nullable().optional(),
    penaltyAmount: z.number().min(0).nullable().optional(),
    substanceCorrections: z.array(z.object({
      ruleSubstanceId: cuidSchema,
      substanceName: z.string().min(1).optional(),
      casNumber: z.string().nullable().optional(),
      eenumber: z.string().nullable().optional(),
      threshold: z.number().min(0).nullable().optional(),
      thresholdUnit: z.string().nullable().optional(),
    })).optional(),
  }).optional(),
});

export const regulatorySearchSchema = z.object({
  query: z.string().min(1).max(500),
  jurisdiction: z.array(z.string()).optional(),
  sourceType: z.array(z.enum([
    "STATE_BILL", "FEDERAL_BILL", "FDA_RULE", "FDA_GUIDANCE",
    "FDA_PROPOSED_RULE", "FEDERAL_REGISTER_NOTICE", "RETAILER_MANDATE",
    "INTERNATIONAL_REGULATION",
  ])).optional(),
  ruleType: z.array(z.enum([
    "BAN", "WARNING_LABEL", "DISCLOSURE", "PHASE_OUT",
    "CONCENTRATION_LIMIT", "REPORTING", "CERTIFICATION",
    "INGREDIENT_REVIEW", "MARKET_WITHDRAWAL",
  ])).optional(),
  status: z.array(z.enum([
    "DETECTED", "PROCESSING", "PARSED", "SME_REVIEW",
    "SME_APPROVED", "SME_REJECTED", "ACTIVE", "REPEALED",
    "SUPERSEDED", "ENJOINDED",
  ])).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const matchRuleSubstancesSchema = z.object({
  tenantId: cuidSchema,
  useLlm: z.boolean().default(true),
  minConfidence: z.number().min(0).max(1).default(0.7),
});

// ============================================================================
// Cascade schemas
// ============================================================================
export const cascadeGraphRebuildSchema = z.object({
  fullRebuild: z.boolean().default(false),
});

export const cascadeTriggerAnalyzeSchema = z.object({
  maxDepth: z.number().int().min(1).max(10).default(6),
  includeCostEstimates: z.boolean().default(true),
  includeTimelineConflicts: z.boolean().default(true),
});

export const cascadeExposureSchema = z.object({
  jurisdiction: z.array(z.string()).optional(),
  productCategory: z.array(z.string()).optional(),
  minSeverity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]).optional(),
  includeCostEstimates: z.boolean().default(true),
});

export const cascadeDiagnosticSchema = z.object({
  productCategories: z.array(z.string()).min(1),
  markets: z.array(z.string()).min(1),
  ingredientsOfConcern: z.array(z.string()).optional(),
  plan: z.enum(["DIAGNOSTIC", "SCOUT", "PRO", "COMMAND"]).optional(),
});

// ============================================================================
// Decision schemas
// ============================================================================
export const decisionDecideSchema = z.object({
  decision: z.enum(["accept", "reject", "defer", "partial"]),
  notes: z.string().max(5000).optional(),
});

// ============================================================================
// Agent query schemas
// ============================================================================
export const agentQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  conversationId: cuidSchema.optional(),
  contextFilters: z.object({
    jurisdiction: z.array(z.string()).optional(),
    productCategory: z.array(z.string()).optional(),
    severity: z.array(z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])).optional(),
  }).optional(),
});

// ============================================================================
// Diagnostic schemas
// ============================================================================
export const diagnosticCreateSchema = z.object({
  companyName: z.string().min(2).max(200),
  contactEmail: emailSchema,
  contactName: z.string().min(2).max(200),
  productCategories: z.array(z.string()).min(1),
  markets: z.array(z.string()).min(1),
  ingredientsOfConcern: z.array(z.string()).optional(),
  erpSystem: z.enum(["NETSUITE", "SAP_B1", "DYNAMICS_365_BC", "INFOR_M3", "EPICOR_P21", "OTHER", "NONE"]).optional(),
});

export const diagnosticPaymentSchema = z.object({
  paymentMethodId: z.string().min(1),
});

// ============================================================================
// Pagination schema
// ============================================================================
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ============================================================================
// Workflow schemas
// ============================================================================
export const workflowCreateSchema = z.object({
  decisionPackageId: cuidSchema.optional(),
  workflowType: z.enum([
    "reformulation",
    "label_change",
    "product_withdrawal",
    "compliance_review",
  ]),
  assignedTo: z.array(cuidSchema).min(1),
  notes: z.string().max(5000).optional(),
});

export const workflowActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  notes: z.string().max(5000).optional(),
});
