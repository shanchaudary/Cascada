# Cascada — Architecture Contract

> **THIS IS THE SINGLE SOURCE OF TRUTH.** Before writing ANY code in ANY stage, re-read this file. If code contradicts this document, the code is wrong.

---

## 1. Product Definition

**Cascada** is a multi-tenant SaaS platform that detects regulatory and retailer mandate changes affecting food manufacturers, traces those changes through the customer's actual product portfolio (ingredients → formulations → products → customers), and delivers decision packages to the C-suite with SKU-level exposure, reformulation cost estimates, and compliance timelines.

**Not a monitoring tool.** Monitoring tells you something changed. Cascada tells you what it means for YOUR business.

**Not a compliance tool.** Compliance tools manage HACCP plans and audit readiness. Cascada manages regulatory CHANGE IMPACT at the strategic level.

**Not a PLM.** PLM manages recipes and specifications. Cascada connects regulatory changes TO those recipes and specifications.

---

## 2. Tech Stack (Frozen)

| Layer            | Technology                        | Version                                       | Rationale                                                     |
| ---------------- | --------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Runtime          | Node.js                           | 20 LTS                                        | LTS stability, Temporal SDK support                           |
| Framework        | Next.js                           | 15.x (App Router; lockfile currently 15.5.20) | API routes + frontend in one deploy                           |
| Language         | TypeScript                        | 5.x strict mode                               | No `any`, no escape hatches                                   |
| ORM              | Prisma                            | 6.x (lockfile currently 6.19.3)               | Type-safe DB access, migrations                               |
| Database         | PostgreSQL                        | 16                                            | Primary data store                                            |
| Graph Engine     | Apache AGE                        | PG extension                                  | Graph queries inside PostgreSQL                               |
| Cache/Queue      | Redis                             | 7.x                                           | Job queues, session cache, rate limiting                      |
| Workflow         | Temporal.io                       | 1.24+                                         | Durable workflow execution                                    |
| LLM - Primary    | OpenAI                            | GPT-4o / GPT-4o-mini                          | Structured output, tool calling                               |
| LLM - Fallback   | Anthropic                         | Claude 3.5 Sonnet                             | Backup when OpenAI fails                                      |
| LLM SDK          | Vercel AI SDK                     | 4.x                                           | Unified interface for multiple providers                      |
| Frontend         | React 19 + Tailwind 4 + shadcn/ui | Latest                                        | Component library                                             |
| Charts           | Recharts                          | 2.x                                           | Dashboard visualizations                                      |
| Auth             | NextAuth.js                       | 5.x (Auth.js)                                 | JWT + session management                                      |
| Email            | Resend                            | API                                           | Transactional email                                           |
| PDF              | @react-pdf/renderer               | 4.x                                           | Diagnostic report generation                                  |
| Logging          | Pino                              | 9.x                                           | Structured JSON logging                                       |
| Validation       | Zod                               | 3.x                                           | Runtime type validation                                       |
| Testing          | Vitest                            | Latest                                        | Unit/regression tests; Playwright is not currently configured |
| Containerization | Docker + Docker Compose           | Latest                                        | Local dev and deployment                                      |
| Orchestration    | Kubernetes                        | 1.29+                                         | Production deployment                                         |
| IaC              | Terraform                         | 1.7+                                          | Cloud infrastructure                                          |
| CI/CD            | GitHub Actions                    | N/A                                           | Automated pipelines                                           |
| Monitoring       | Prometheus + Grafana              | Latest                                        | Metrics and dashboards                                        |

---

## 3. Database Schema (Frozen)

### 3.1 Tenant Management

```prisma
model Tenant {
  id            String    @id @default(cuid())
  name          String
  slug          String    @unique
  plan          Plan      @default(DIAGNOSTIC)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  users         User[]
  erpConnections ErpConnection[]
  formulations  Formulation[]
  products      Product[]
  customers     Customer[]
  suppliers     Supplier[]
  cascadeGraphs CascadeGraph[]
  decisionPkgs  DecisionPackage[]
  diagnostics   Diagnostic[]

  @@map("tenants")
}

enum Plan {
  DIAGNOSTIC    // Paid diagnostic only
  SCOUT         // $36K/yr - monitoring + alerts
  PRO           // $84K/yr - cascade analysis + query agent
  COMMAND       // $156K/yr - full platform + workflow orchestration
}
```

### 3.2 User & Auth

```prisma
model User {
  id            String    @id @default(cuid())
  tenantId      String
  email         String
  name          String
  passwordHash  String?
  role          UserRole  @default(VIEWER)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  tenant        Tenant    @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, email])
  @@map("users")
}

enum UserRole {
  SUPER_ADMIN   // Platform admin
  TENANT_ADMIN  // Company admin
  COMPLIANCE    // Compliance team
  EXECUTIVE     // C-suite (read-only + decision)
  VIEWER        // Read-only
}
```

### 3.3 ERP Connections

```prisma
model ErpConnection {
  id              String          @id @default(cuid())
  tenantId        String
  erpType         ErpType
  connectionName  String
  connectionString String         @db.Text  // Encrypted in application layer
  authConfig      Json            // Encrypted OAuth/token config
  syncState       Json            // Last sync watermark, cursor positions
  syncStatus      SyncStatus      @default(DISCONNECTED)
  lastSyncAt      DateTime?
  lastSyncError   String?
  fieldMappings   Json            // Custom field mapping config
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  tenant          Tenant          @relation(fields: [tenantId], references: [id])
  syncLogs        SyncLog[]

  @@map("erp_connections")
}

enum ErpType {
  NETSUITE
  SAP_B1
  DYNAMICS_365_BC
  INFOR_M3
  EPICOR_P21
}

enum SyncStatus {
  DISCONNECTED
  CONNECTED
  SYNCING
  ERROR
  RATE_LIMITED
}

model SyncLog {
  id              String        @id @default(cuid())
  erpConnectionId String
  syncType        String        // "full" | "incremental"
  entityType      String        // "items" | "boms" | "suppliers" | "customers"
  recordsTotal    Int
  recordsSuccess  Int
  recordsFailed   Int
  errorDetails    Json?
  startedAt       DateTime
  completedAt     DateTime?
  duration        Int?          // milliseconds

  erpConnection   ErpConnection @relation(fields: [erpConnectionId], references: [id])

  @@map("sync_logs")
}
```

### 3.4 Ingredients & Formulations (from ERP)

```prisma
model Ingredient {
  id              String        @id @default(cuid())
  tenantId        String
  erpId           String?       // ID in the customer's ERP
  name            String
  alternateNames  String[]      // Common aliases for matching
  casNumber       String?       // Chemical Abstracts Service number
  eenumber        String?       // European E-number
  category        String?       // "dye" | "preservative" | "flavor" | "emulsifier" | etc.
  isSynthetic     Boolean?
  sourceType      String?       // "petroleum" | "plant" | "animal" | "mineral" | "synthetic"
  allergenFlags   String[]      // ["dairy", "soy", "gluten", etc.]
  supplierIds     String[]      // Links to Supplier records
  metadata        Json?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])
  formulationItems FormulationItem[]
  ruleSubstances  RuleSubstance[]
  substitutionOptions SubstitutionOption[]

  @@unique([tenantId, name])
  @@map("ingredients")
}

model Formulation {
  id              String        @id @default(cuid())
  tenantId        String
  erpId           String?       // BOM ID from ERP
  name            String
  description     String?
  version         Int           @default(1)
  status          FormulationStatus @default(DRAFT)
  batchSize       Float?
  batchSizeUnit   String?
  totalCost       Decimal?      @db.Decimal(12, 4)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])
  items           FormulationItem[]
  products        ProductFormulation[]

  @@unique([tenantId, erpId, version])
  @@map("formulations")
}

enum FormulationStatus {
  DRAFT
  ACTIVE
  ARCHIVED
  UNDER_REVIEW
}

model FormulationItem {
  id              String        @id @default(cuid())
  formulationId   String
  ingredientId    String
  quantity        Decimal       @db.Decimal(12, 6)
  unit            String        // "kg" | "g" | "mg" | "L" | "mL" | "%"
  percentage      Decimal?      @db.Decimal(8, 4)
  isAlternate     Boolean       @default(false)
  replacesIngredientId String?
  sortOrder       Int

  formulation     Formulation   @relation(fields: [formulationId], references: [id], onDelete: Cascade)
  ingredient      Ingredient    @relation(fields: [ingredientId], references: [id])

  @@map("formulation_items")
}

model SubstitutionOption {
  id                    String    @id @default(cuid())
  tenantId              String
  originalIngredientId  String
  substituteIngredientId String
  substitutionCost      Decimal?  @db.Decimal(12, 4)  // Per unit cost delta
  feasibilityScore      Decimal?  @db.Decimal(3, 2)   // 0-1, assessed by R&D
  sensoryImpact         String?   // "none" | "minor" | "moderate" | "significant"
  shelfLifeImpact       String?   // "none" | "minor" | "reduced_X_months"
  regulatoryRisk        String?   // "none" | "review_needed" | "restricted_in_some_jurisdictions"
  notes                 String?
  source                String?   // "ai_suggestion" | "rd_validated" | "supplier_recommended"
  createdAt             DateTime  @default(now())

  originalIngredient    Ingredient @relation("OriginalSub", fields: [originalIngredientId], references: [id])
  substituteIngredient  Ingredient @relation("SubstituteSub", fields: [substituteIngredientId], references: [id])

  @@map("substitution_options")
}
```

### 3.5 Products & Customers

```prisma
model Product {
  id              String        @id @default(cuid())
  tenantId        String
  erpId           String?       // SKU from ERP
  name            String
  sku             String
  category        String?       // Product category
  brand           String?
  markets         String[]      // States/countries where sold
  retailers       String[]      // ["walmart", "target", "kroger", etc.]
  isActive        Boolean       @default(true)
  annualVolume    Decimal?      @db.Decimal(12, 2)  // Units per year
  annualRevenue   Decimal?      @db.Decimal(12, 2)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])
  formulations    ProductFormulation[]
  customerProducts CustomerProduct[]
  cascadeImpacts  CascadeImpact[]

  @@unique([tenantId, sku])
  @@map("products")
}

model ProductFormulation {
  id              String        @id @default(cuid())
  productId       String
  formulationId   String
  isCurrent       Boolean       @default(true)
  effectiveDate   DateTime      @default(now())

  product         Product       @relation(fields: [productId], references: [id], onDelete: Cascade)
  formulation     Formulation   @relation(fields: [formulationId], references: [id])

  @@map("product_formulations")
}

model Customer {
  id              String        @id @default(cuid())
  tenantId        String
  erpId           String?
  name            String
  type            CustomerType
  requirements    Json?         // Retailer-specific compliance requirements
  contactEmail    String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])
  customerProducts CustomerProduct[]

  @@unique([tenantId, name])
  @@map("customers")
}

enum CustomerType {
  RETAILER
  DISTRIBUTOR
  FOODSERVICE
  PRIVATE_LABEL
  DIRECT_TO_CONSUMER
}

model CustomerProduct {
  id              String        @id @default(cuid())
  customerId      String
  productId       String
  specVersion     String?
  specRequirements Json?        // Customer-specific spec requirements
  isActive        Boolean       @default(true)

  customer        Customer      @relation(fields: [customerId], references: [id], onDelete: Cascade)
  product         Product       @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@map("customer_products")
}

model Supplier {
  id              String        @id @default(cuid())
  tenantId        String
  erpId           String?
  name            String
  contactEmail    String?
  certifications  String[]
  ingredientIds   String[]      // Ingredients they supply
  riskScore       Decimal?      @db.Decimal(3, 2)  // 0-1 supply risk
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, name])
  @@map("suppliers")
}
```

### 3.6 Regulatory Rules (The Moat)

```prisma
model RegulatorySource {
  id              String        @id @default(cuid())
  sourceType      SourceType
  jurisdiction    String        // "US", "US-CA", "US-TX", "US-NY", etc.
  name            String        // "California AB 418", "Texas SB 25", etc.
  sourceId        String?       // LegiScan bill ID, Federal Register document ID, etc.
  sourceUrl       String?
  status          SourceStatus
  introducedDate  DateTime?
  enactedDate     DateTime?
  effectiveDate   DateTime?
  fullText        String?       @db.Text
  rawApiResponse  Json?         // Full API response for audit trail
  processedAt     DateTime?
  processingError String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  rules           Rule[]

  @@map("regulatory_sources")
}

enum SourceType {
  STATE_BILL
  FEDERAL_BILL
  FDA_RULE
  FDA_GUIDANCE
  FDA_PROPOSED_RULE
  FEDERAL_REGISTER_NOTICE
  RETAILER_MANDATE
  INTERNATIONAL_REGULATION
}

enum SourceStatus {
  DETECTED          // New, not yet processed
  PROCESSING        // LLM parsing in progress
  PARSED            // LLM extraction complete
  SME_REVIEW        // Awaiting SME validation
  SME_APPROVED      // SME has validated
  SME_REJECTED      // SME found errors
  ACTIVE            // Live and enforced
  REPEALED          // No longer in effect
  SUPERSEDED        // Replaced by newer regulation
  ENJOINDED         // Court-blocked
}

model Rule {
  id              String        @id @default(cuid())
  sourceId        String
  version         Int           @default(1)
  previousVersionId String?     // Link to previous version of this rule
  jurisdiction    String
  ruleType        RuleType
  description     String        @db.Text
  effectiveDate   DateTime?
  complianceDate  DateTime?     // Deadline for compliance
  gracePeriodDays Int?
  penaltyType     String?       // "civil" | "criminal" | "product_ban" | "fine_per_violation"
  penaltyAmount   Decimal?      @db.Decimal(12, 2)
  exemptions      Json?         // Product/category exemptions
  notes           String?       @db.Text
  smeValidatedBy  String?       // User ID of SME reviewer
  smeValidatedAt  DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  source          RegulatorySource @relation(fields: [sourceId], references: [id])
  substances      RuleSubstance[]
  cascadeTriggers CascadeTrigger[]

  @@unique([sourceId, version])
  @@map("rules")
}

enum RuleType {
  BAN                     // Substance is banned
  WARNING_LABEL           // Warning label required
  DISCLOSURE              // Disclosure of substance required
  PHASE_OUT               // Phase out by date
  CONCENTRATION_LIMIT     // Maximum allowed concentration
  REPORTING               // Reporting requirement
  CERTIFICATION           // Certification requirement
  INGREDIENT_REVIEW       // Subject to safety review
  MARKET_WITHDRAWAL       // Must withdraw from market
}

model RuleSubstance {
  id              String        @id @default(cuid())
  ruleId          String
  ingredientId    String?       // Link to ingredient if matched
  substanceName   String        // Name as it appears in the regulation
  substanceType   String        // "specific_chemical" | "chemical_class" | "functional_category"
  casNumber       String?
  eenumber        String?
  threshold       Decimal?      @db.Decimal(12, 6)  // Concentration threshold if applicable
  thresholdUnit   String?       // "ppm" | "%" | "mg/kg" | etc.
  productScope    Json?         // Product categories this applies to
  isMatched       Boolean       @default(false)  // Has this been matched to an Ingredient?
  matchConfidence Decimal?      @db.Decimal(3, 2)  // 0-1 confidence of ingredient match
  matchMethod     String?       // "exact" | "alias" | "cas_number" | "llm_inferred" | "manual"

  rule            Rule          @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  ingredient      Ingredient?   @relation(fields: [ingredientId], references: [id])

  @@map("rule_substances")
}
```

### 3.7 Cascade Engine

```prisma
model CascadeGraph {
  id              String        @id @default(cuid())
  tenantId        String
  version         Int           @default(1)
  nodeCount       Int           @default(0)
  edgeCount       Int           @default(0)
  lastRebuiltAt   DateTime
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])
  nodes           CascadeNode[]
  edges           CascadeEdge[]
  triggers        CascadeTrigger[]

  @@map("cascade_graphs")
}

model CascadeNode {
  id              String        @id @default(cuid())
  graphId         String
  nodeType        CascadeNodeType
  entityId        String        // ID of the entity this node represents
  label           String
  properties      Json          // Node-specific properties
  riskScore       Decimal?      @db.Decimal(5, 4)  // 0-1
  createdAt       DateTime      @default(now())

  graph           CascadeGraph  @relation(fields: [graphId], references: [id], onDelete: Cascade)
  outEdges        CascadeEdge[] @relation("SourceNode")
  inEdges         CascadeEdge[] @relation("TargetNode")

  @@unique([graphId, nodeType, entityId])
  @@map("cascade_nodes")
}

enum CascadeNodeType {
  INGREDIENT
  FORMULATION
  PRODUCT
  CUSTOMER
  REGULATION
  RETAILER_REQUIREMENT
  SUPPLIER
}

model CascadeEdge {
  id              String        @id @default(cuid())
  graphId         String
  sourceNodeId    String
  targetNodeId    String
  edgeType        CascadeEdgeType
  properties      Json          // Edge-specific properties (e.g., concentration, contract terms)
  strength        Decimal?      @db.Decimal(3, 2)  // 0-1, how strong is this dependency
  validFrom       DateTime?
  validTo         DateTime?
  createdAt       DateTime      @default(now())

  graph           CascadeGraph  @relation(fields: [graphId], references: [id], onDelete: Cascade)
  sourceNode      CascadeNode   @relation("SourceNode", fields: [sourceNodeId], references: [id], onDelete: Cascade)
  targetNode      CascadeNode   @relation("TargetNode", fields: [targetNodeId], references: [id], onDelete: Cascade)

  @@map("cascade_edges")
}

enum CascadeEdgeType {
  CONTAINS                 // Formulation CONTAINS Ingredient
  PRODUCED_FROM            // Product PRODUCED_FROM Formulation
  SOLD_TO                  // Product SOLD_TO Customer
  SUBJECT_TO               // Product SUBJECT_TO Regulation
  REQUIRES                 // Customer REQUIRES specification
  SUPPLIED_BY              // Ingredient SUPPLIED_BY Supplier
  SUPERSEDES               // Regulation SUPERSEDES Regulation
  CONFLICTS_WITH           // Regulation CONFLICTS_WITH Regulation
}

model CascadeTrigger {
  id              String        @id @default(cuid())
  graphId         String
  ruleId          String
  triggerType     TriggerType
  severity        Severity
  title           String
  description     String        @db.Text
  affectedNodeIds String[]      // CascadeNode IDs directly affected
  cascadeDepth    Int           // How many hops the cascade reaches
  cascadeBreadth  Int           // How many functional areas affected
  totalSkusAffected Int
  estimatedCostMin Decimal?     @db.Decimal(12, 2)
  estimatedCostMax Decimal?     @db.Decimal(12, 2)
  deadlineDate    DateTime?
  conflictDates   Json?         // Conflicting compliance deadlines
  status          TriggerStatus @default(DETECTED)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  graph           CascadeGraph  @relation(fields: [graphId], references: [id])
  rule            Rule          @relation(fields: [ruleId], references: [id])
  impacts         CascadeImpact[]
  decisionPackage DecisionPackage?

  @@map("cascade_triggers")
}

enum TriggerType {
  NEW_REGULATION
  REGULATION_AMENDMENT
  REGULATION_REPEAL
  RETAILER_MANDATE_CHANGE
  SUPPLIER_DISRUPTION
  INGREDIENT_SHORTAGE
}

enum Severity {
  CRITICAL   // Immediate action required, product ban or large financial exposure
  HIGH       // Action required within 30 days
  MEDIUM     // Action required within 90 days
  LOW        // Monitor, no immediate action
  INFO       // Awareness only
}

enum TriggerStatus {
  DETECTED
  ANALYZING
  IMPACT_ASSESSED
  DECISION_PACKAGE_READY
  DECISION_MADE
  WORKFLOW_STARTED
  COMPLETED
  DISMISSED
}

model CascadeImpact {
  id              String        @id @default(cuid())
  triggerId       String
  nodeId          String
  impactType      ImpactType
  description     String
  financialImpact Decimal?      @db.Decimal(12, 2)
  timelineImpact  Int?          // Days delay
  reformRequired  Boolean       @default(false)
  reformCost      Decimal?      @db.Decimal(12, 2)
  reformOptions   Json?         // Array of reformulation options
  priority        Int?          // 1-10

  trigger         CascadeTrigger @relation(fields: [triggerId], references: [id], onDelete: Cascade)

  @@map("cascade_impacts")
}

enum ImpactType {
  REFORMULATION_REQUIRED
  LABEL_CHANGE_REQUIRED
  PRODUCT_WITHDRAWAL
  REFORMULATION_COST
  SUPPLY_CHAIN_DISRUPTION
  CUSTOMER_SPEC_VIOLATION
  REGULATORY_PENALTY
  SHELF_SPACE_LOSS
  MARKET_ACCESS_LOSS
}
```

### 3.8 Decision Packages & Workflows

```prisma
model DecisionPackage {
  id              String        @id @default(cuid())
  tenantId        String
  triggerId       String        @unique
  title           String
  summary         String        @db.Text
  mandateSummary  String        @db.Text
  affectedSkuList Json          // Array of affected SKUs with details
  complianceTimeline Json       // Timeline with conflicts
  reformulationOptions Json     // Cost-benefit analysis
  prioritization  Json          // Risk × Impact × Urgency rankings
  recommendation  String        @db.Text
  generatedAt     DateTime      @default(now())
  deliveredAt     DateTime?
  deliveryMethod  String?       // "dashboard" | "email" | "pdf"
  decision        String?       // "accept" | "reject" | "defer" | "partial"
  decidedBy       String?       // User ID
  decidedAt       DateTime?
  decisionNotes   String?

  tenant          Tenant        @relation(fields: [tenantId], references: [id])
  trigger         CascadeTrigger @relation(fields: [triggerId], references: [id])

  @@map("decision_packages")
}

model WorkflowInstance {
  id              String        @id @default(cuid())
  tenantId        String
  decisionPackageId String?
  workflowType    String
  temporalWorkflowId String?    // Temporal workflow execution ID
  status          WorkflowStatus @default(PENDING)
  currentStep     String?
  steps           Json          // Array of workflow step definitions
  assignedTo      String[]      // User IDs
  startedAt       DateTime?
  completedAt     DateTime?
  errorDetail     String?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])

  @@map("workflow_instances")
}

enum WorkflowStatus {
  PENDING
  RUNNING
  AWAITING_APPROVAL
  COMPLETED
  FAILED
  CANCELLED
  TIMED_OUT
}
```

### 3.9 Diagnostics (Paid Wedge)

```prisma
model Diagnostic {
  id              String        @id @default(cuid())
  tenantId        String
  companyName     String
  contactEmail    String
  contactName     String
  status          DiagnosticStatus @default(REQUESTED)
  paymentStatus   PaymentStatus @default(PENDING)
  amount          Decimal       @db.Decimal(12, 2)
  formData        Json          // What the customer submitted
  resultData      Json?         // The diagnostic output
  reportUrl       String?       // URL to generated PDF
  completedAt     DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])

  @@map("diagnostics")
}

enum DiagnosticStatus {
  REQUESTED
  PAID
  PROCESSING
  COMPLETED
  DELIVERED
  EXPIRED
}

enum PaymentStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  REFUNDED
}
```

### 3.10 Audit & System

```prisma
model AuditLog {
  id              String        @id @default(cuid())
  tenantId        String?
  userId          String?
  action          String
  entityType      String
  entityId        String?
  oldValue        Json?
  newValue        Json?
  ipAddress       String?
  userAgent       String?
  createdAt       DateTime      @default(now())

  @@map("audit_logs")
}

model LlmUsageLog {
  id              String        @id @default(cuid())
  tenantId        String?
  model           String
  promptTokens    Int
  completionTokens Int
  totalTokens     Int
  costUsd         Decimal       @db.Decimal(10, 6)
  taskType        String        // "rule_parsing" | "query_agent" | "reformulation" | etc.
  success         Boolean
  errorMessage    String?
  latencyMs       Int
  createdAt       DateTime      @default(now())

  @@map("llm_usage_logs")
}

model PipelineRun {
  id              String        @id @default(cuid())
  pipelineType    String        // "legiscan" | "openfda" | "federal_register" | "usda"
  status          String        // "running" | "completed" | "failed"
  recordsProcessed Int
  recordsNew      Int
  recordsUpdated  Int
  recordsFailed   Int
  errorDetail     String?
  startedAt       DateTime
  completedAt     DateTime?
  duration        Int?          // milliseconds

  @@map("pipeline_runs")
}
```

---

## 4. API Routes (Frozen)

### 4.1 Auth

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/refresh
GET    /api/auth/me
```

### 4.2 Tenants

```
GET    /api/tenants/current
PATCH  /api/tenants/current
GET    /api/tenants/current/users
POST   /api/tenants/current/users
PATCH  /api/tenants/current/users/:id
DELETE /api/tenants/current/users/:id
```

### 4.3 ERP Connections

```
GET    /api/erp-connections
POST   /api/erp-connections
GET    /api/erp-connections/:id
PATCH  /api/erp-connections/:id
DELETE /api/erp-connections/:id
POST   /api/erp-connections/:id/test
POST   /api/erp-connections/:id/sync
GET    /api/erp-connections/:id/sync-logs
GET    /api/erp-connections/:id/status
```

### 4.4 Ingredients

```
GET    /api/ingredients
POST   /api/ingredients
GET    /api/ingredients/:id
PATCH  /api/ingredients/:id
GET    /api/ingredients/:id/substitutions
POST   /api/ingredients/:id/substitutions
POST   /api/ingredients/match-rule-substances
```

### 4.5 Formulations

```
GET    /api/formulations
POST   /api/formulations
GET    /api/formulations/:id
PATCH  /api/formulations/:id
GET    /api/formulations/:id/items
POST   /api/formulations/:id/items
```

### 4.6 Products

```
GET    /api/products
POST   /api/products
GET    /api/products/:id
PATCH  /api/products/:id
GET    /api/products/:id/exposure
```

### 4.7 Regulatory Sources & Rules

```
GET    /api/regulatory/sources
GET    /api/regulatory/sources/:id
POST   /api/regulatory/sources/:id/process
POST   /api/regulatory/sources/:id/validate
GET    /api/regulatory/rules
GET    /api/regulatory/rules/:id
GET    /api/regulatory/rules/:id/substances
GET    /api/regulatory/search
```

### 4.8 Cascade Engine

```
GET    /api/cascade/graph
POST   /api/cascade/graph/rebuild
GET    /api/cascade/graph/stats
GET    /api/cascade/triggers
GET    /api/cascade/triggers/:id
POST   /api/cascade/triggers/:id/analyze
GET    /api/cascade/triggers/:id/impacts
GET    /api/cascade/exposure
POST   /api/cascade/exposure/diagnostic
```

### 4.9 Decision Packages

```
GET    /api/decisions
GET    /api/decisions/:id
POST   /api/decisions/:id/decide
GET    /api/decisions/:id/report
```

### 4.10 Executive Query Agent

```
POST   /api/agent/query
GET    /api/agent/conversations
GET    /api/agent/conversations/:id
POST   /api/agent/conversations/:id/message
```

### 4.11 Workflows

```
GET    /api/workflows
POST   /api/workflows
GET    /api/workflows/:id
POST   /api/workflows/:id/approve
POST   /api/workflows/:id/reject
GET    /api/workflows/:id/steps
```

### 4.12 Diagnostics (Paid Wedge - Target Routes)

The committed implementation currently exposes `POST /api/cascade/exposure/diagnostic` and the `/dashboard/diagnostic` UI. The dedicated `/api/diagnostics/*` lifecycle routes below remain target contract routes, not verified implemented routes.

```
POST   /api/diagnostics
GET    /api/diagnostics
GET    /api/diagnostics/:id
POST   /api/diagnostics/:id/pay
GET    /api/diagnostics/:id/report
POST   /api/diagnostics/:id/generate
```

### 4.13 Dashboard

```
GET    /api/dashboard/summary
GET    /api/dashboard/exposure-by-state
GET    /api/dashboard/exposure-by-product
GET    /api/dashboard/upcoming-deadlines
GET    /api/dashboard/recent-triggers
GET    /api/dashboard/cost-estimates
```

---

## 5. File Structure (Frozen)

```
Cascada/
├── docs/
│   ├── CONTRACT.md              # This file
│   ├── API.md                   # Full API documentation
│   ├── DEPLOYMENT.md            # Deployment guide
│   └── ERP_INTEGRATION.md       # ERP connector guide
├── prisma/
│   ├── schema.prisma            # Database schema
│   ├── migrations/              # Migration files
│   └── seed.ts                  # Seed data (real structure, no fake SKUs)
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── (auth)/              # Auth pages
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   ├── dashboard/         # Main dashboard
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── exposure/page.tsx
│   │   │   ├── triggers/page.tsx
│   │   │   ├── triggers/[id]/page.tsx
│   │   │   ├── regulations/page.tsx
│   │   │   ├── decisions/page.tsx
│   │   │   ├── decisions/[id]/page.tsx
│   │   │   ├── agent/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   ├── integrations/page.tsx
│   │   │   └── diagnostic/page.tsx
│   │   └── api/                 # API routes (see Section 4)
│   │       ├── auth/
│   │       ├── tenants/
│   │       ├── erp-connections/
│   │       ├── ingredients/
│   │       ├── formulations/
│   │       ├── products/
│   │       ├── regulatory/
│   │       ├── cascade/
│   │       ├── decisions/
│   │       ├── agent/
│   │       ├── workflows/
│   │       ├── diagnostics/
│   │       └── dashboard/
│   ├── lib/                     # Core business logic
│   │   ├── db.ts                # Prisma client singleton
│   │   ├── auth.ts              # Auth configuration
│   │   ├── logger.ts            # Pino logger config
│   │   ├── errors.ts            # Custom error types
│   │   ├── llm/                 # LLM integration
│   │   │   ├── client.ts        # Unified LLM client
│   │   │   ├── prompts/         # Versioned prompt templates
│   │   │   │   ├── rule-parser.ts
│   │   │   │   ├── substance-extractor.ts
│   │   │   │   ├── query-agent.ts
│   │   │   │   └── reformulation-advisor.ts
│   │   │   ├── structured-output.ts  # Zod schema enforcement
│   │   │   ├── cost-tracker.ts       # Token usage and cost tracking
│   │   │   └── fallback.ts           # Model fallback routing
│   │   ├── pipelines/           # Data ingestion pipelines
│   │   │   ├── types.ts         # Shared pipeline types
│   │   │   ├── orchestrator.ts  # Pipeline scheduling and coordination
│   │   │   ├── legiscan/        # LegiScan client
│   │   │   │   ├── client.ts
│   │   │   │   ├── transforms.ts
│   │   │   │   └── types.ts
│   │   │   ├── openfda/         # openFDA client
│   │   │   │   ├── client.ts
│   │   │   │   ├── transforms.ts
│   │   │   │   └── types.ts
│   │   │   ├── federal-register/ # Federal Register client
│   │   │   │   ├── client.ts
│   │   │   │   ├── transforms.ts
│   │   │   │   └── types.ts
│   │   │   └── usda/            # USDA FoodData client
│   │   │       ├── client.ts
│   │   │       ├── transforms.ts
│   │   │       └── types.ts
│   │   ├── rules/               # Rule interpretation engine
│   │   │   ├── parser.ts        # LLM-based bill parsing
│   │   │   ├── substance-matcher.ts  # Match substances to ingredients
│   │   │   ├── rule-builder.ts  # Construct Rule records from parsed data
│   │   │   ├── versioning.ts    # Rule version management
│   │   │   └── validation.ts    # SME validation workflow
│   │   ├── cascade/             # Cascade graph engine
│   │   │   ├── builder.ts       # Graph construction from tenant data
│   │   │   ├── traverser.ts     # Multi-hop cascade traversal
│   │   │   ├── impact-scorer.ts # Severity and priority scoring
│   │   │   ├── cost-model.ts    # Reformulation cost estimation
│   │   │   ├── timeline.ts      # Compliance timeline + conflict detection
│   │   │   ├── prioritizer.ts   # Risk × Impact × Urgency ranking
│   │   │   └── graph-queries.ts # AGE/Cypher query helpers
│   │   ├── erp/                 # ERP connectors
│   │   │   ├── types.ts         # Shared ERP types
│   │   │   ├── base-connector.ts # Abstract base class
│   │   │   ├── sync-engine.ts   # Incremental sync with watermark
│   │   │   ├── netsuite/        # NetSuite SuiteTalk REST
│   │   │   │   ├── connector.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── mappings.ts
│   │   │   │   └── types.ts
│   │   │   ├── sap-b1/          # SAP Business One Service Layer
│   │   │   │   ├── connector.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── mappings.ts
│   │   │   │   └── types.ts
│   │   │   ├── dynamics365/     # Dynamics 365 Business Central
│   │   │   │   ├── connector.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── mappings.ts
│   │   │   │   └── types.ts
│   │   │   ├── infor-m3/        # Infor CloudSuite M3
│   │   │   │   ├── connector.ts
│   │   │   │   ├── auth.ts
│   │   │   │   ├── mappings.ts
│   │   │   │   └── types.ts
│   │   │   └── epicor-p21/      # Epicor Prophet 21
│   │   │       ├── connector.ts
│   │   │       ├── auth.ts
│   │   │       ├── mappings.ts
│   │   │       └── types.ts
│   │   ├── agent/               # AI agents
│   │   │   ├── executive-query.ts    # C-suite Q&A agent
│   │   │   ├── reformulation.ts      # Reformulation advisor
│   │   │   ├── workflow-generator.ts # Decision → workflow
│   │   │   ├── tools.ts              # Function calling definitions
│   │   │   └── context.ts            # RAG context builder
│   │   ├── workflows/           # Temporal workflows
│   │   │   ├── reformulation-workflow.ts
│   │   │   ├── label-change-workflow.ts
│   │   │   ├── product-withdrawal-workflow.ts
│   │   │   ├── compliance-review-workflow.ts
│   │   │   └── activities/      # Workflow activities
│   │   │       ├── notify-team.ts
│   │   │       ├── create-tasks.ts
│   │   │       └── update-erp.ts
│   │   └── diagnostic/          # 50-state diagnostic
│   │       ├── analyzer.ts      # Exposure analysis logic
│   │       ├── report-generator.ts  # PDF generation
│   │       └── payment.ts       # Payment processing
│   ├── components/              # React components
│   │   ├── ui/                  # shadcn/ui base components
│   │   ├── dashboard/           # Dashboard-specific components
│   │   ├── exposure/            # Exposure view components
│   │   ├── regulations/         # Regulation list/detail
│   │   ├── decisions/           # Decision package components
│   │   ├── agent/               # Chat interface
│   │   ├── integrations/        # ERP connection management
│   │   └── diagnostic/          # Diagnostic form + report
│   ├── hooks/                   # React hooks
│   ├── types/                   # TypeScript type definitions
│   │   ├── api.ts
│   │   ├── erp.ts
│   │   ├── cascade.ts
│   │   ├── regulatory.ts
│   │   └── diagnostic.ts
│   └── utils/                   # Utility functions
│       ├── formatting.ts
│       ├── dates.ts
│       └── validation.ts
├── tests/
│   ├── unit/
│   └── integration/
├── k8s/                         # Kubernetes manifests
│   ├── namespace.yaml
│   ├── app-deployment.yaml
│   ├── app-service.yaml
│   ├── postgres-statefulset.yaml
│   ├── redis-deployment.yaml
│   ├── temporal-deployment.yaml
│   ├── ingress.yaml
│   ├── hpa.yaml
│   ├── configmap.yaml
│   └── secrets.yaml
├── terraform/                   # Infrastructure as code
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── providers.tf
│   ├── vpc.tf
│   ├── rds.tf
│   ├── elasticache.tf
│   ├── ecs.tf
│   └── monitoring.tf
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── cd-staging.yml
│       └── cd-production.yml
├── docker-compose.yml
├── Dockerfile
├── Dockerfile.temporal
├── .env.example
├── .eslintrc.json
├── .prettierrc
├── tsconfig.json
├── next.config.ts
├── vitest.config.ts
├── package.json
└── PROGRESS.md                  # Build progress tracker
```

---

## 6. Environment Variables (Frozen)

```env
# Database
DATABASE_URL=postgresql://cascada:password@localhost:5432/cascada
DATABASE_URL_DIRECT=postgresql://cascada:password@localhost:5432/cascada

# Redis
REDIS_URL=redis://localhost:6379

# Auth
NEXTAUTH_SECRET=<generate-random-32-chars>
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
CASCADA_DEV_AUTH=true

# LLM
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Data Pipelines
LEGISCAN_API_KEY=<from-legiscan>
OPENFDA_API_KEY=<optional-increases-rate-limit>
USDA_API_KEY=<from-usda-fooddata-central>
# Federal Register uses a public API and does not require an API key.
# Legacy FEDERAL_REGISTER_API_KEY values are ignored if present.

# ERP - NetSuite
NETSUITE_ACCOUNT=
NETSUITE_CONSUMER_KEY=
NETSUITE_CONSUMER_SECRET=
NETSUITE_TOKEN_ID=
NETSUITE_TOKEN_SECRET=

# ERP - SAP B1
SAP_B1_SERVER=
SAP_B1_COMPANY_DB=
SAP_B1_USERNAME=
SAP_B1_PASSWORD=

# ERP - Dynamics 365 BC
D365_TENANT_ID=
D365_CLIENT_ID=
D365_CLIENT_SECRET=
D365_ENVIRONMENT=
D365_COMPANY_ID=

# ERP - Infor M3
INFOR_TENANT_ID=
INFOR_CLIENT_ID=
INFOR_CLIENT_SECRET=
INFOR_ORGANIZATION=

# ERP - Epicor P21
EPICOR_P21_SERVER=
EPICOR_P21_COMPANY=
EPICOR_P21_USERNAME=
EPICOR_P21_PASSWORD=

# Temporal
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=cascada
TEMPORAL_TASK_QUEUE=cascada-tasks

# Email
RESEND_API_KEY=re_...

# Payments
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Application
NODE_ENV=development
APP_URL=http://localhost:3000
LOG_LEVEL=debug
ENCRYPTION_KEY=<generate-random-32-chars>
```

---

## 7. Key Architectural Decisions (Frozen)

| Decision              | Choice                                                | Rationale                                                                    | Alternatives Rejected                                                                   |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Graph DB              | Apache AGE inside PostgreSQL                          | Avoids operating a separate Neo4j cluster; AGE provides Cypher queries on PG | Neo4j (too much infra for MVP), JanusGraph (overkill)                                   |
| Multi-tenancy         | Shared DB, tenant-scoped queries with RLS             | Simplest operational model for startup phase                                 | Separate DB per tenant (too expensive), separate schema per tenant (complex migrations) |
| LLM Integration       | Vercel AI SDK with OpenAI primary, Anthropic fallback | Unified interface, built-in streaming, edge-compatible                       | Direct API calls (more boilerplate), LangChain (too abstracted, hard to debug)          |
| Workflow Engine       | Temporal.io                                           | Durable execution, built-in retry, saga patterns, observability              | BullMQ (not durable), Inngest (less mature), custom (reinventing the wheel)             |
| Frontend Framework    | Next.js 15 App Router                                 | API routes + frontend in one deploy, server components                       | Separate React + Express (more infra), Remix (smaller ecosystem)                        |
| ERP Integration       | Abstract base class + per-ERP connector               | Common interface, each ERP implements the same contract                      | Integration platform (Celigo/Workato — adds $2K-5K/mo cost per customer)                |
| Structured LLM Output | Zod schema + Vercel AI SDK `generateObject()`         | Forces LLM to produce valid JSON matching our types                          | Free-form chat + manual parsing (fragile, hallucination-prone)                          |
| Rule Versioning       | Linked list of Rule versions                          | Full audit trail, can compare versions, supports repeal/supersede            | Overwrite-in-place (no history), event sourcing (overkill)                              |
| Payment               | Stripe                                                | Industry standard, supports one-time + subscription                          | PayPal (worse DX), custom (not worth building)                                          |

---

## 8. Anti-Toy Commitments (Frozen)

These are non-negotiable. Every stage must pass these checks:

1. **No hardcoded ingredient/regulation arrays** — all data from DB or API
2. **No mock API functions** — every function calls real endpoints or real DB
3. **No TODO/FIXME/stub** — if it's in the codebase, it's implemented
4. **Error handling is structured** — custom error types, not `console.log`
5. **Auth is JWT + RBAC** — not a bypass middleware
6. **Multi-tenancy is row-level** — not application-level filtering
7. **Database is PostgreSQL** — not SQLite or in-memory
8. **Tests test real behavior** — not happy path only
9. **ERP connectors call real API patterns** — not fake data
10. **LLM integration uses structured output** — not free-form chat
11. **Files are properly sized** — no 100-line modules that should be 1000
12. **Infrastructure is real** — Docker Compose with proper config
13. **Secrets are in env vars** — never in source code
14. **Logging is structured JSON** — not console.log
15. **API documentation exists** — not just auto-generated

---

## 9. Stage Gate Definitions (Frozen)

| Stage | Name            | Must Deliver                            | Must Pass                 |
| ----- | --------------- | --------------------------------------- | ------------------------- |
| 0     | Contract        | This document                           | User approval             |
| 1     | Foundation      | Schema, Docker, scaffold                | `prisma validate` passes  |
| 2     | Data Pipelines  | 4 pipeline clients                      | Real API data flows       |
| 3     | Rule Engine     | LLM parser + SME validation             | Real bill excerpt parsed  |
| 4     | Cascade Engine  | Graph + traversal + scoring             | Test graph with 50+ nodes |
| 5     | ERP Connectors  | 5 connectors with real API patterns     | Connector code review     |
| 6     | AI Agents       | Query + reformulation + workflow agents | Agent trace is real       |
| 7     | Workflows       | Temporal workflows + activities         | Workflow trace is real    |
| 8     | Dashboard + API | Full frontend + all API routes          | Dev server runs           |
| 9     | Diagnostic      | 50-state exposure scan + PDF            | PDF generates             |
| 10    | Infrastructure  | K8s + Terraform + CI/CD                 | Manifests reviewed        |
| 11    | Tests + Docs    | Full test suite + documentation         | Tests pass                |

---

_This contract is frozen. Changes require explicit user approval._
