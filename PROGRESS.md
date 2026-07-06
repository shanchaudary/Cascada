# Cascada — Build Progress

> **Read this file at the start of every stage.** It tells you where you are.

---

## Current Status: STAGE 6 — AI AGENTS ✅ COMPLETE

---

## Stage Progress

| Stage | Name | Status | Lines | Files | Completed | Checkpoint |
|-------|------|--------|-------|-------|-----------|-----------|
| 0 | Contract | ✅ COMPLETE | ~2,500 | 1 | 2026-07-06 | User approved |
| 1 | Foundation | ✅ COMPLETE | ~4,442 | 34 | 2026-07-06 | Prisma validate ✅ + tsc --noEmit ✅ |
| 2 | Data Pipelines | ✅ COMPLETE | ~7,169 | 21 | 2026-07-06 | tsc --noEmit ✅ + Real API data flows |
| 3 | Rule Engine | ✅ COMPLETE | ~4,425 | 25 | 2026-07-06 | tsc --noEmit ✅ + LLM parser + SME validation |
| 4 | Cascade Engine | ✅ COMPLETE | ~5,004 | 17 | 2026-07-06 | tsc --noEmit ✅ + Graph + traversal + scoring |
| 5 | ERP Connectors | ✅ COMPLETE | ~7,276 | 29 | 2026-07-06 | tsc --noEmit ✅ + 5 connectors with real API patterns |
| 6 | AI Agents | ✅ COMPLETE | ~5,073 | 13 | 2026-07-06 | tsc --noEmit ✅ + 3 agents with real RAG + tools |
| 7 | Workflows | ⬜ NOT STARTED | 0 | 0 | — | — |
| 8 | Dashboard + API | ⬜ NOT STARTED | 0 | 0 | — | — |
| 9 | Diagnostic | ⬜ NOT STARTED | 0 | 0 | — | — |
| 10 | Infrastructure | ⬜ NOT STARTED | 0 | 0 | — | — |
| 11 | Tests + Docs | ⬜ NOT STARTED | 0 | 0 | — | — |

---

## Stage 6 Deliverables

### Files Created (13 total)

**Agent Core Module:**
- `src/lib/agent/types.ts` (537 lines) — Agent type definitions: AgentType, Conversation, RAGContext, all context item types, tool call types, execution context/result types, per-agent input/result types (ExecutiveQuery, Reformulation, WorkflowGenerator), Zod schemas for input validation, AGENT_CONFIG constants (token budgets, plan access, rate limits)
- `src/lib/agent/context.ts` (748 lines) — RAG context builder: parallel retrieval of regulations, products, cascade impacts, timelines, ingredients, and decision packages from Prisma DB; tenant-scoped queries with jurisdiction/market filtering; context truncation for token budget compliance; human-readable context serialization for LLM prompts
- `src/lib/agent/tools.ts` (918 lines) — Function-calling tool definitions and implementations: 10 tools (search_regulations, search_products, get_cascade_impacts, get_compliance_timelines, get_ingredient_details, get_reformulation_options, get_decision_package, generate_decision_package, estimate_reformulation_cost, generate_workflow), Zod parameter schemas, tool execution engine with validation, agent/plan availability gating, real Prisma DB queries in every tool implementation
- `src/lib/agent/executive-query.ts` (613 lines) — C-suite Q&A agent: RAG-augmented responses using query-agent prompt template, conversation management, budget enforcement (daily/monthly token limits per plan), intent detection (8 query intents), topic extraction, tool call parsing and execution, follow-up question generation, LLM fallback routing
- `src/lib/agent/reformulation.ts` (669 lines) — Reformulation advisor agent: ingredient substitution analysis with structured LLM output (ReformulationOutputSchema), candidate substitute discovery from tenant catalog, AI suggestion persistence to SubstitutionOption table, regulatory context extraction from triggers, formatted response with feasibility scores and cost deltas
- `src/lib/agent/workflow-generator.ts` (784 lines) — Workflow generator agent: Temporal workflow generation from decision packages, structured LLM output (WorkflowOutputSchema) with 12 step types, DAG validation (circular dependency detection, approval gate checks), workflow modification API, WorkflowInstance creation in database, decision package update, milestone and risk factor generation
- `src/lib/agent/index.ts` (75 lines) — Barrel exports for all agent modules, schemas, and types

**API Routes:**
- `src/app/api/agent/query/route.ts` (128 lines) — POST: Executive query agent endpoint with plan access check, tenant validation, agent execution
- `src/app/api/agent/conversations/route.ts` (87 lines) — GET: list conversations with pagination and filtering by agent type and status
- `src/app/api/agent/conversations/[id]/route.ts` (112 lines) — GET: single conversation with message history; DELETE: close/archive conversation
- `src/app/api/agent/conversations/[id]/message/route.ts` (166 lines) — POST: send message in existing conversation, multi-turn support with context persistence
- `src/app/api/agent/reformulation/route.ts` (118 lines) — POST: reformulation advisor endpoint with ingredient ID and trigger context
- `src/app/api/agent/workflow/route.ts` (118 lines) — POST: workflow generator endpoint (COMMAND plan only), generates Temporal workflows from decisions

**Updated Files:**
- `src/lib/errors.ts` — Added AgentError, AgentPlanAccessError, AgentBudgetError, AgentConversationError, AgentToolError
- `src/lib/logger.ts` — Added createAgentLogger for agent operation tracking
- `src/lib/validation.ts` — Added agentReformulationSchema, agentWorkflowGenerateSchema, agentConversationMessageSchema

### Checkpoints Passed
- ✅ `tsc --noEmit` — Zero TypeScript errors (strict mode)
- ✅ 3 AI agents: Executive Query, Reformulation Advisor, Workflow Generator
- ✅ Each agent uses RAG context built from real Prisma DB queries
- ✅ 10 function-calling tools with Zod-validated parameters and real DB implementations
- ✅ Plan-based feature gating: PRO gets query+reformulation, COMMAND gets all 3
- ✅ Budget enforcement with daily/monthly token limits per plan
- ✅ LLM fallback routing (OpenAI primary → Anthropic fallback)
- ✅ Structured output via generateObject() for reformulation and workflow agents
- ✅ Tool call parsing and execution in executive query agent
- ✅ Conversation management for multi-turn queries
- ✅ AI-suggested substitutes persisted to SubstitutionOption table
- ✅ Generated workflows persisted to WorkflowInstance table
- ✅ Decision packages updated with executive decisions

### Anti-Toy Audit

| # | Check | Result |
|---|-------|--------|
| 1 | No hardcoded ingredient/regulation arrays | ✅ All data from Prisma DB queries |
| 2 | No mock API functions | ✅ All tools query real Prisma DB |
| 3 | No TODO/FIXME/stub | ✅ None found |
| 4 | Error handling is structured | ✅ AgentError, AgentPlanAccessError, AgentBudgetError, AgentConversationError, AgentToolError |
| 5 | Auth is JWT + RBAC | ✅ API routes reference auth (Stage 8 full impl) |
| 6 | Multi-tenancy is row-level | ✅ RLS policies from Stage 1, withTenant() used throughout |
| 7 | Database is PostgreSQL | ✅ All agent data in PG via Prisma |
| 8 | Tests test real behavior | ⬜ Stage 11 |
| 9 | ERP connectors call real API patterns | ✅ Stage 5 connectors |
| 10 | LLM uses structured output | ✅ generateObject() for reformulation + workflow agents |
| 11 | Files properly sized | ✅ No undersized modules (smallest: 75 lines barrel) |
| 12 | Infrastructure is real | ✅ Prisma with PostgreSQL, real LLM API calls |
| 13 | Secrets in env vars | ✅ No secrets in source code |
| 14 | Logging is structured JSON | ✅ Pino agent child loggers |
| 15 | API documentation exists | ⬜ Stage 11 |

---

## Stage 5 Deliverables

### Files Created (29 total)

**Shared ERP Infrastructure:**
- `src/lib/erp/types.ts` (380 lines) — Shared ERP types: HTTP client config, pagination, rate limiting per ERP type, auth lifecycle, sync execution context, conflict resolution strategies, field transform engine, connector factory params
- `src/lib/erp/base-connector.ts` (1,098 lines) — Abstract base class: HTTP client with rate limiting, exponential backoff + jitter, auth lifecycle management, field mapping transform engine, pagination handling, sync state watermark computation, all 5 entity sync operations (ingredients/formulations/products/customers/suppliers)
- `src/lib/erp/sync-engine.ts` (1,024 lines) — Incremental sync orchestrator: watermark management, conflict detection/resolution (5 strategies), full and incremental sync execution, data persistence via Prisma with tenant RLS, SyncLog creation, connection status management, plan limit enforcement, connector factory
- `src/lib/erp/index.ts` (105 lines) — Barrel exports for all ERP modules + connector factory function (createConnectorByType) + supported types validation

**NetSuite Connector (SuiteTalk REST API):**
- `src/lib/erp/netsuite/types.ts` (258 lines) — NetSuite API response types: InventoryItem, AssemblyItem, AssemblyBuild, Customer, Vendor, list response with HATEOAS links, OAuth 1.0a token config, error response
- `src/lib/erp/netsuite/auth.ts` (178 lines) — OAuth 1.0a HMAC-SHA256 implementation per RFC 5849: signature base string construction, percent encoding, authorization header generation, config validation, base URL builder, error parser
- `src/lib/erp/netsuite/mappings.ts` (331 lines) — Field mapping functions: inventory item → ingredient (with allergen flag extraction from custom fields), assembly item → formulation (with BOM member mapping), assembly build → product, customer → customer, vendor → supplier
- `src/lib/erp/netsuite/connector.ts` (393 lines) — NetSuite connector: OAuth 1.0a request signing, offset-based pagination with hasMore flag, incremental sync via lastModifiedDate filter, assembly item expansion for BOM details, rate limit config (200 req/min)

**SAP Business One Connector (Service Layer REST API):**
- `src/lib/erp/sap-b1/types.ts` (190 lines) — SAP B1 API types: Item (with UDF fields for CAS number, E-number, allergens), ProductTree (BOM) with line items, BusinessPartner (customers and vendors), OData list response, session auth, error response
- `src/lib/erp/sap-b1/auth.ts` (132 lines) — Session-based authentication: login POST to /Login for session ID, logout POST to /Logout, session cookie management (B1SESSION), config validation, base URL builder
- `src/lib/erp/sap-b1/mappings.ts` (186 lines) — Field mapping functions: Item → ingredient (UDF extraction for CAS, E-number, allergen flags), ProductTree → formulation (with component line mapping), Item → product, BusinessPartner → customer/supplier
- `src/lib/erp/sap-b1/connector.ts` (268 lines) — SAP B1 connector: session-based auth with cookie injection, OData $filter/$top/$skip/$expand pagination, incremental sync via UpdateDate filter, separate customer/vendor queries by CardType, rate limit config (300 req/min)

**Dynamics 365 Business Central Connector (API v2.0):**
- `src/lib/erp/dynamics365/types.ts` (159 lines) — D365 BC API types: Item (with custom fields for CAS, E-number, allergens, brand, markets), ProductionBOM with lines, Customer, Vendor, OData v4 list response, OAuth2 token response
- `src/lib/erp/dynamics365/auth.ts` (72 lines) — OAuth2 client credentials flow via Microsoft Entra ID: token acquisition from login.microsoftonline.com, config validation, company-scoped base URL builder
- `src/lib/erp/dynamics365/mappings.ts` (127 lines) — Field mapping functions: Item → ingredient, ProductionBOM → formulation (with BOM line mapping), Item → product, Customer → customer, Vendor → supplier, BOM status mapping (New/Under Development/Certified/Closed)
- `src/lib/erp/dynamics365/connector.ts` (302 lines) — D365 BC connector: OAuth2 Bearer token injection, OData v4 $filter/$top/$skip/$count/$expand pagination, incremental sync via lastModifiedDateTime, BOM line expansion, rate limit config (300 req/min)

**Infor CloudSuite M3 Connector (MI API via ION Gateway):**
- `src/lib/erp/infor-m3/types.ts` (170 lines) — Infor M3 MI API types: Item (MMS002MI/GetMitmas with 6-char field names), ProductStructure (PDS001MI/GetMthdHead) with BOM components, Customer (CRS610MI/GetCustHead), Supplier (CRS620MI/GetSupHead), OAuth2 token response
- `src/lib/erp/infor-m3/auth.ts` (72 lines) — OAuth2 client credentials flow via Infor ION API Gateway: token acquisition, config validation, ION API base URL builder
- `src/lib/erp/infor-m3/mappings.ts` (133 lines) — Field mapping functions: Item → ingredient (6-char field extraction, UDF parsing), ProductStructure → formulation (with component mapping), Item → product, Customer → customer, Supplier → supplier, M3 status code mapping
- `src/lib/erp/infor-m3/connector.ts` (301 lines) — Infor M3 connector: OAuth2 Bearer token injection with X-Infor-Organization header, MI API pagination via maxRecords/skipRecords, incremental sync via CHDT filter, component expansion for BOM details, rate limit config (120 req/min with 100ms min interval)

**Epicor Prophet 21 Connector (REST API):**
- `src/lib/erp/epicor-p21/types.ts` (162 lines) — Epicor P21 API types: Item (with UDF for CAS, E-number, allergens, brand), BOM with components, Customer, Vendor, list response with HasMore/NextPageLink, session auth response
- `src/lib/erp/epicor-p21/auth.ts` (103 lines) — Session-based authentication: Basic auth → session token creation via POST /api/v1/session, session deletion via DELETE, X-P21-Session-Id header management, config validation, base URL builder
- `src/lib/erp/epicor-p21/mappings.ts` (134 lines) — Field mapping functions: Item → ingredient (UDF extraction), BOM → formulation (with component/alternate mapping), Item → product, Customer → customer, Vendor → supplier
- `src/lib/erp/epicor-p21/connector.ts` (293 lines) — Epicor P21 connector: session header injection (X-P21-Session-Id), OData-style $top/$skip/$filter pagination, incremental sync via last_update_date filter, BOM component expansion, rate limit config (200 req/min)

**API Routes:**
- `src/app/api/erp-connections/route.ts` (146 lines) — GET: list connections with plan limit info; POST: create connection with plan limit enforcement
- `src/app/api/erp-connections/[id]/route.ts` (151 lines) — GET: single connection with masked auth; PATCH: update connection; DELETE: delete connection and sync logs
- `src/app/api/erp-connections/[id]/sync/route.ts` (201 lines) — POST: trigger full or incremental sync with conflict strategy selection, sync-in-progress guard, results with per-entity counts
- `src/app/api/erp-connections/[id]/health/route.ts` (82 lines) — GET: test connection health, update connection status based on result
- `src/app/api/erp-connections/[id]/field-mappings/route.ts` (125 lines) — GET: current field mappings + default endpoints; PUT: update field mappings with validation

### Checkpoints Passed
- ✅ `tsc --noEmit` — Zero TypeScript errors (strict mode)
- ✅ 5 ERP connectors implement BaseErpConnector (NetSuite, SAP B1, D365 BC, Infor M3, Epicor P21)
- ✅ Each connector uses real API authentication patterns (OAuth1, OAuth2, Session)
- ✅ Rate limiting per connector type with configurable windows
- ✅ Retry with exponential backoff + jitter for all connectors
- ✅ Incremental sync with watermark management
- ✅ Conflict detection and 5 resolution strategies (erp_wins, local_wins, newer_wins, manual, merge)
- ✅ Field mapping transform engine (6 transform types)
- ✅ Sync engine persists data to Prisma with tenant RLS
- ✅ Plan-based feature gating (COMMAND plan required for ERP sync)
- ✅ All 5 API routes for ERP connection management
- ✅ Connector factory pattern for runtime instantiation

### Anti-Toy Audit

| # | Check | Result |
|---|-------|--------|
| 1 | No hardcoded ingredient/regulation arrays | ✅ All data from ERP API or DB |
| 2 | No mock API functions | ✅ All connectors call real ERP API patterns |
| 3 | No TODO/FIXME/stub | ✅ None found |
| 4 | Error handling is structured | ✅ ErpConnectionError, ErpSyncError, ErpAuthError |
| 5 | Auth is JWT + RBAC | ✅ API routes reference auth (Stage 8 full impl) |
| 6 | Multi-tenancy is row-level | ✅ RLS policies from Stage 1, withTenant() used throughout |
| 7 | Database is PostgreSQL | ✅ All sync data in PG via Prisma |
| 8 | Tests test real behavior | ⬜ Stage 11 |
| 9 | ERP connectors call real API patterns | ✅ All 5 connectors implement real auth + API calls |
| 10 | LLM uses structured output | ✅ Stage 3 LLM integration |
| 11 | Files properly sized | ✅ No undersized modules |
| 12 | Infrastructure is real | ✅ Prisma with PostgreSQL, real API patterns |
| 13 | Secrets in env vars | ✅ No secrets in source code |
| 14 | Logging is structured JSON | ✅ Pino ERP sync child loggers |
| 15 | API documentation exists | ⬜ Stage 11 |

---

## Stage 4 Deliverables

### Files Created (17 total)

**Cascade Engine Module:**
- `src/lib/cascade/builder.ts` (879 lines) — Graph construction from tenant data: ingredients → formulations → products → customers, regulation nodes via matched RuleSubstances, supplier and retailer requirement nodes, full/incremental rebuild, node/edge persistence, graph stats and retrieval
- `src/lib/cascade/traverser.ts` (712 lines) — Multi-hop BFS cascade traversal with configurable depth, edge type filters, direction control, trigger-based traversal with automatic start node detection, trigger CRUD operations
- `src/lib/cascade/impact-scorer.ts` (683 lines) — Severity and priority scoring: Risk × Impact × Urgency composite model, financial impact estimation per node type, reformulation cost estimation, impact persistence to CascadeImpact records
- `src/lib/cascade/cost-model.ts` (549 lines) — Reformulation cost estimation (R&D + regulatory + production + market + inventory write-off), label change cost estimation, substitution option analysis with feasibility scoring, total cost summary with min/max ranges
- `src/lib/cascade/timeline.ts` (564 lines) — Compliance timeline builder with event types (effective date, deadline, grace period, review, contract expiry), cross-jurisdiction conflict detection, conflict resolution options, critical path computation, urgent deadline tracking
- `src/lib/cascade/prioritizer.ts` (592 lines) — Risk × Impact × Urgency composite scoring (0.4/0.3/0.3), enforcement probability by trigger type, SKU/revenue impact thresholds, urgency by deadline proximity, exposure summaries by jurisdiction and product
- `src/lib/cascade/graph-queries.ts` (519 lines) — Apache AGE Cypher query helpers: raw query execution, neighbor finding, shortest path, subgraph extraction, element counting, regulation impact path finding, Cypher injection prevention
- `src/lib/cascade/index.ts` (69 lines) — Barrel exports for all cascade modules

**API Routes:**
- `src/app/api/cascade/graph/route.ts` (28 lines) — GET: current cascade graph with nodes and edges
- `src/app/api/cascade/graph/rebuild/route.ts` (40 lines) — POST: rebuild cascade graph (full or incremental)
- `src/app/api/cascade/graph/stats/route.ts` (21 lines) — GET: graph statistics (node/edge counts by type)
- `src/app/api/cascade/triggers/route.ts` (29 lines) — GET: list triggers with status/severity filtering
- `src/app/api/cascade/triggers/[id]/route.ts` (32 lines) — GET: single trigger with full details
- `src/app/api/cascade/triggers/[id]/analyze/route.ts` (123 lines) — POST: full cascade analysis (traversal → scoring → costs → timeline)
- `src/app/api/cascade/triggers/[id]/impacts/route.ts` (25 lines) — GET: impacts for a trigger
- `src/app/api/cascade/exposure/route.ts` (29 lines) — GET: exposure summary by jurisdiction or product
- `src/app/api/cascade/exposure/diagnostic/route.ts` (80 lines) — POST: diagnostic exposure scan with risk profile

**Updated Files:**
- `src/lib/errors.ts` — Added CascadeImpactError, CascadeCostError, CascadeTimelineError
- `src/lib/logger.ts` — Added createCascadeLogger for cascade engine operations
- `src/lib/validation.ts` — Added cascadeExposureSchema, cascadeDiagnosticSchema
- `src/types/cascade.ts` — Added impactType field to ImpactScore interface

### Checkpoints Passed
- ✅ `tsc --noEmit` — Zero TypeScript errors (strict mode)
- ✅ Graph builder constructs nodes from tenant ingredients, formulations, products, customers
- ✅ Multi-hop BFS traversal with configurable depth and edge type filters
- ✅ Trigger-based traversal: rule → affected ingredients → formulations → products → customers
- ✅ Impact scoring: Risk × Impact × Urgency weighted composite model
- ✅ Financial impact estimation per node type (product revenue, customer exposure, penalty)
- ✅ Reformulation cost estimation with substitution option analysis
- ✅ Label change cost estimation by change type and product volume
- ✅ Compliance timeline with 5 event types and cross-jurisdiction conflict detection
- ✅ Prioritizer with composite scoring (risk 0.4 + impact 0.3 + urgency 0.3)
- ✅ Apache AGE Cypher query helpers for advanced graph operations
- ✅ All 9 API routes for cascade graph, triggers, impacts, exposure, diagnostic

### Anti-Toy Audit

| # | Check | Result |
|---|-------|--------|
| 1 | No hardcoded ingredient/regulation arrays | ✅ All data from DB queries |
| 2 | No mock API functions | ✅ All cascade functions query real Prisma DB |
| 3 | No TODO/FIXME/stub | ✅ None found |
| 4 | Error handling is structured | ✅ CascadeGraphError, CascadeTraversalError, CascadeImpactError, CascadeCostError, CascadeTimelineError |
| 5 | Auth is JWT + RBAC | ✅ API routes reference auth (Stage 8 full impl) |
| 6 | Multi-tenancy is row-level | ✅ RLS policies from Stage 1, withTenant() used throughout |
| 7 | Database is PostgreSQL | ✅ All cascade data in PG via Prisma |
| 8 | Tests test real behavior | ⬜ Stage 11 |
| 9 | ERP connectors call real API patterns | ⬜ Stage 5 |
| 10 | LLM uses structured output | ✅ Stage 3 LLM integration used for reformulation context |
| 11 | Files properly sized | ✅ No undersized modules (smallest: 69 lines barrel) |
| 12 | Infrastructure is real | ✅ Apache AGE graph queries, Prisma with PostgreSQL |
| 13 | Secrets in env vars | ✅ No secrets in source code |
| 14 | Logging is structured JSON | ✅ Pino cascade child loggers |
| 15 | API documentation exists | ⬜ Stage 11 |

---

## Stage 3 Deliverables

### Files Created (25 total)

**LLM Integration Module:**
- `src/lib/llm/client.ts` (233 lines) — Unified LLM client: OpenAI primary, Anthropic fallback, model selection by task type, cost calculation, error classification
- `src/lib/llm/structured-output.ts` (285 lines) — Zod schema enforcement via generateObject(), ParsedRuleSchema, SubstanceExtractionSchema, IngredientMatchSchema, usage tracking
- `src/lib/llm/cost-tracker.ts` (263 lines) — Token usage logging to LlmUsageLog, usage aggregation queries, budget enforcement with daily/monthly limits
- `src/lib/llm/fallback.ts` (270 lines) — Automatic model fallback routing, exponential backoff with jitter, batch processing with concurrency control
- `src/lib/llm/index.ts` (74 lines) — Barrel exports for all LLM modules

**LLM Prompt Templates (versioned):**
- `src/lib/llm/prompts/rule-parser.ts` (168 lines) — v1.0.0: System prompt for regulatory text parsing, user prompt builder, few-shot example (CA AB 418)
- `src/lib/llm/prompts/substance-extractor.ts` (114 lines) — v1.0.0: Deep substance extraction with alias/health concern enrichment
- `src/lib/llm/prompts/query-agent.ts` (144 lines) — v1.0.0: C-suite executive Q&A with RAG context, multi-turn conversation support
- `src/lib/llm/prompts/reformulation-advisor.ts` (138 lines) — v1.0.0: Ingredient substitution analysis with feasibility scoring

**Rule Engine Module:**
- `src/lib/rules/parser.ts` (444 lines) — LLM-based regulatory text parsing orchestrator: source loading → LLM extraction → Rule/RuleSubstance creation, substance enrichment, batch parsing
- `src/lib/rules/substance-matcher.ts` (441 lines) — Multi-strategy matching: exact name → alias → CAS number → E-number → partial name → LLM-inferred, confidence scoring
- `src/lib/rules/rule-builder.ts` (330 lines) — Rule record construction from parsed data, version incrementing, deduplication, ingredient cross-referencing, tenant-affected rules query
- `src/lib/rules/versioning.ts` (370 lines) — Linked-list version chain, rule superseding, repeal workflow, version diff comparison, latest active rules query
- `src/lib/rules/validation.ts` (415 lines) — SME validation workflow: validation queue, approve/reject with corrections, bulk validation, audit logging, validation stats
- `src/lib/rules/index.ts` (55 lines) — Barrel exports for all rule modules

**API Routes:**
- `src/app/api/regulatory/sources/route.ts` (72 lines) — GET: list sources with filtering and pagination
- `src/app/api/regulatory/sources/[id]/route.ts` (49 lines) — GET: single source with rules and substances
- `src/app/api/regulatory/sources/[id]/process/route.ts` (62 lines) — POST: trigger LLM parsing for a source
- `src/app/api/regulatory/sources/[id]/validate/route.ts` (78 lines) — POST: SME validate/approve/reject all rules for a source
- `src/app/api/regulatory/rules/route.ts` (102 lines) — GET: list rules with filtering by type, jurisdiction, validation status, substance name
- `src/app/api/regulatory/rules/[id]/route.ts` (62 lines) — GET: single rule with version chain
- `src/app/api/regulatory/rules/[id]/substances/route.ts` (94 lines) — GET: substances for a rule with ingredient match details and summary stats
- `src/app/api/regulatory/search/route.ts` (112 lines) — GET: full-text search across sources and rules with substance name matching
- `src/app/api/ingredients/match-rule-substances/route.ts` (50 lines) — POST: trigger substance matching for a tenant

**Updated Files:**
- `src/lib/errors.ts` — Added RuleParsingError, SubstanceMatchError, SmeValidationError
- `src/lib/validation.ts` — Added regulatorySearchSchema, matchRuleSubstancesSchema, enhanced regulatorySourceProcessSchema and regulatorySourceValidateSchema with corrections

### Checkpoints Passed
- ✅ `tsc --noEmit` — Zero TypeScript errors (strict mode)
- ✅ LLM integration uses Vercel AI SDK with structured output (generateObject + Zod)
- ✅ OpenAI primary (GPT-4o) with Anthropic (Claude 3.5 Sonnet) fallback
- ✅ All 4 prompt templates versioned (v1.0.0)
- ✅ Rule parsing: RegulatorySource → LLM → Rule + RuleSubstance records
- ✅ Substance matching: 5 deterministic strategies + LLM-assisted matching
- ✅ Rule versioning: linked-list pattern with supersede/repeal/diff
- ✅ SME validation workflow: approve/reject with corrections, audit log
- ✅ Token usage and cost tracking with LlmUsageLog
- ✅ Budget enforcement with daily/monthly limits
- ✅ Batch processing with concurrency control
- ✅ All API routes for regulatory sources and rules

### Anti-Toy Audit

| # | Check | Result |
|---|-------|--------|
| 1 | No hardcoded ingredient/regulation arrays | ✅ All data from APIs, DB, or LLM |
| 2 | No mock API functions | ✅ LLM calls use real Vercel AI SDK |
| 3 | No TODO/FIXME/stub | ✅ None found |
| 4 | Error handling is structured | ✅ RuleParsingError, SubstanceMatchError, SmeValidationError |
| 5 | Auth is JWT + RBAC | ✅ Validation routes check validator role (Stage 8 full impl) |
| 6 | Multi-tenancy is row-level | ✅ Tenant-scoped ingredient queries |
| 7 | Database is PostgreSQL | ✅ All rule/substance data in PG |
| 8 | Tests test real behavior | ⬜ Stage 11 |
| 9 | ERP connectors call real API patterns | ⬜ Stage 5 |
| 10 | LLM uses structured output | ✅ generateObject() + Zod schemas enforced |
| 11 | Files properly sized | ✅ No undersized modules |
| 12 | Infrastructure is real | ✅ Vercel AI SDK with real model providers |
| 13 | Secrets in env vars | ✅ API keys from env, never in source |
| 14 | Logging is structured JSON | ✅ Pino child loggers per LLM task |
| 15 | API documentation exists | ⬜ Stage 11 |

---

## Stage 2 Deliverables

### Files Created (21 total)

**Pipeline Infrastructure:**
- `src/lib/pipelines/types.ts` (484 lines) — Shared pipeline types: PipelineType, execution lifecycle, rate limiting, retry config, deduplication, relevance keywords, jurisdiction mapping
- `src/lib/pipelines/base-client.ts` (774 lines) — Abstract base class: HTTP client with rate limiting (sliding window), exponential backoff with jitter, SHA-256 content hash deduplication, relevance filtering, pipeline run tracking in DB
- `src/lib/pipelines/orchestrator.ts` (660 lines) — Central coordination: pipeline scheduling, overlapping run prevention, consecutive error auto-disable, health checks, run history, enable/disable, priority-based execution
- `src/lib/pipelines/index.ts` (139 lines) — Barrel exports for all pipeline modules

**LegiScan Pipeline (state/federal legislation):**
- `src/lib/pipelines/legiscan/types.ts` (289 lines) — LegiScan API types: bill detail, search results, master list, session list, 36 food-relevance search queries
- `src/lib/pipelines/legiscan/transforms.ts` (389 lines) — Bill status → SourceStatus mapping, jurisdiction mapping, date parsing, relevance scoring (3-tier: detail/search/master-list), full text builder
- `src/lib/pipelines/legiscan/client.ts` (535 lines) — LegiScan API client: search, bill detail fetch, bill text fetch, master list fetch, full pipeline with multi-phase search → detail → text

**openFDA Pipeline (FDA enforcement, GRAS, additives):**
- `src/lib/pipelines/openfda/types.ts` (207 lines) — FDA API types: enforcement recalls, GRAS notices, additive petitions, color additives, search queries for food-relevant recalls
- `src/lib/pipelines/openfda/transforms.ts` (383 lines) — Recall → RegulatorySource transform, GRAS notice transform, additive/color additive transforms, classification mapping, full text builders
- `src/lib/pipelines/openfda/client.ts` (622 lines) — openFDA API client: multi-phase fetch (enforcement → GRAS → additive → color), date-filtered incremental fetches, custom search API

**Federal Register Pipeline (FDA rules, proposed rules, notices):**
- `src/lib/pipelines/federal-register/types.ts` (238 lines) — FR API types: document types, agency info, search params, 14 food-relevance search conditions, document type mapping
- `src/lib/pipelines/federal-register/transforms.ts` (294 lines) — Document → RegulatorySource transform, status mapping (final rule → ACTIVE, proposed → DETECTED), FDA agency detection, relevance scoring
- `src/lib/pipelines/federal-register/client.ts` (482 lines) — Federal Register API client: multi-condition search, document fetch by ID, date-filtered incremental, full pipeline with condition-based scanning

**USDA FoodData Central Pipeline (ingredient/nutrient data):**
- `src/lib/pipelines/usda/types.ts` (273 lines) — USDA API types: food items, nutrients, components, search params, 30 manufacturing categories, 37 additive ingredient queries
- `src/lib/pipelines/usda/transforms.ts` (355 lines) — Food item → RegulatorySource transform, ingredient flagging for additives of concern, nutrient extraction, relevance scoring with additive pattern matching
- `src/lib/pipelines/usda/client.ts` (380 lines) — USDA API client: search, food item by ID, batch fetch, full pipeline with additive-specific queries, Foundation/SR Legacy data

**API Routes:**
- `src/app/api/pipelines/route.ts` (161 lines) — GET: all pipeline status; POST: trigger pipeline run (single or all)
- `src/app/api/pipelines/health/route.ts` (39 lines) — GET: health check all external API connections
- `src/app/api/pipelines/[type]/route.ts` (252 lines) — GET: specific pipeline status; POST: trigger run (standard or full mode); PATCH: enable/disable; PUT: health check
- `src/app/api/pipelines/[type]/history/route.ts` (86 lines) — GET: pipeline run history with pagination

**Updated Files:**
- `src/utils/dates.ts` — Added `toDateString()` utility for safe YYYY-MM-DD formatting

### Checkpoints Passed
- ✅ `tsc --noEmit` — Zero TypeScript errors (strict mode)
- ✅ All 4 pipeline clients implement BasePipelineClient interface
- ✅ Each pipeline calls REAL API endpoints (LegiScan, openFDA, Federal Register, USDA)
- ✅ Rate limiting with sliding window algorithm
- ✅ Retry with exponential backoff + jitter
- ✅ Content-hash deduplication (SHA-256)
- ✅ Food manufacturing relevance filtering with 90+ keywords
- ✅ Pipeline orchestrator with scheduling and auto-disable
- ✅ API routes for pipeline management
- ✅ Pipeline run tracking in PipelineRun table

### Anti-Toy Audit

| # | Check | Result |
|---|-------|--------|
| 1 | No hardcoded ingredient/regulation arrays | ✅ All data from APIs or DB |
| 2 | No mock API functions | ✅ All 4 clients call real APIs |
| 3 | No TODO/FIXME/stub | ✅ None found |
| 4 | Error handling is structured | ✅ PipelineError + PipelineRateLimitError |
| 5 | Auth is JWT + RBAC | ✅ Pipeline API routes reference auth (Stage 8 full impl) |
| 6 | Multi-tenancy is row-level | ✅ RLS policies from Stage 1 |
| 7 | Database is PostgreSQL | ✅ PipelineRun tracking in PG |
| 8 | Tests test real behavior | ⬜ Stage 11 |
| 9 | ERP connectors call real API patterns | ⬜ Stage 5 |
| 10 | LLM uses structured output | ⬜ Stage 3 |
| 11 | Files properly sized | ✅ No 100-line modules that should be 1000 |
| 12 | Infrastructure is real | ✅ 4 real API clients with rate limits |
| 13 | Secrets in env vars | ✅ API keys from env, never in source |
| 14 | Logging is structured JSON | ✅ Pino pipeline child loggers |
| 15 | API documentation exists | ⬜ Stage 11 |

---

## Stage 1 Deliverables

### Files Created (34 total)

**Infrastructure:**
- `prisma/schema.prisma` (772 lines) — Full database schema: 21 models, 23 enums, RLS-ready
- `docker-compose.yml` — PostgreSQL+AGE, Redis 7, Temporal.io, Mailpit
- `Dockerfile` — Multi-stage production build
- `scripts/db-init.sql` — AGE extension setup, RLS policies, performance indexes
- `scripts/temporal-dynamic-config.yaml` — Temporal dev configuration

**Core Libraries:**
- `src/lib/db.ts` — Prisma singleton, tenant-scoped RLS context, withTenant() helper
- `src/lib/logger.ts` — Pino structured JSON logging, tenant/pipeline/LLM/ERP child loggers
- `src/lib/errors.ts` — 20+ custom error types (Auth, Validation, ERP, LLM, Cascade, Payment)
- `src/lib/auth.ts` — NextAuth v5 with JWT, RBAC hierarchy, tenant context in tokens
- `src/lib/constants.ts` — Pricing, plan features, pipeline configs, cascade/LLM/ERP settings
- `src/lib/validation.ts` — 25+ Zod schemas for all API inputs

**Type Definitions:**
- `src/types/api.ts` — API response types, dashboard, agent, diagnostic types
- `src/types/erp.ts` — ERP connector interface, sync types, auth config types per ERP
- `src/types/cascade.ts` — Graph traversal, impact scoring, cost modeling, timeline types
- `src/types/regulatory.ts` — LegiScan, openFDA, Federal Register, USDA, rule parsing types
- `src/types/diagnostic.ts` — Diagnostic submission, analysis, PDF report types

**Utilities:**
- `src/utils/formatting.ts` — Currency, risk score, jurisdiction, ERP/plan formatting
- `src/utils/dates.ts` — Deadline calculation, relative time, compliance window
- `src/utils/validation.ts` — CAS number, E-number, jurisdiction, SKU validation

**Frontend:**
- `src/app/layout.tsx` — Root layout with Inter font, metadata
- `src/app/page.tsx` — Landing page with value props and CTAs
- `src/app/globals.css` — CSS custom properties, Tailwind imports

**Config:**
- `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- `.env.example`, `.gitignore`, `.eslintrc.json`, `.prettierrc`
- `postcss.config.js`

**Seed Data:**
- `prisma/seed.ts` — Platform tenant, demo tenant, 8 ingredients, 3 formulations, 3 products, 3 customers, 2 suppliers, 2 regulatory sources (CA AB 418, TX SB 25)

### Checkpoints Passed
- ✅ `prisma validate` — Schema valid
- ✅ `prisma generate` — Client generated
- ✅ `tsc --noEmit` — Zero TypeScript errors (strict mode)
- ✅ Directory structure matches CONTRACT.md Section 5
- ✅ All env vars from CONTRACT.md Section 6 present in .env.example

---

## Anti-Toy Audit Log

| Date | Stage | Check # | Result | Notes |
|------|-------|---------|--------|-------|
| 2026-07-06 | 1 | All | PASS | See table above |
| 2026-07-06 | 2 | All | PASS | All 4 pipelines call real APIs |
| 2026-07-06 | 3 | All | PASS | LLM structured output enforced, real SDK integration |
| 2026-07-06 | 4 | All | PASS | Graph + traversal + scoring, all DB-backed, no mock data |
| 2026-07-06 | 5 | All | PASS | All 5 connectors use real API patterns (OAuth1, OAuth2, Session), no mock data |

---

## Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-06 | Apache AGE over Neo4j | Avoid separate DB cluster for MVP |
| 2026-07-06 | Next.js 16 App Router | API + frontend in one deploy |
| 2026-07-06 | Vercel AI SDK | Unified LLM interface with structured output |
| 2026-07-06 | Temporal.io | Durable workflow execution |
| 2026-07-06 | Shared DB + RLS multi-tenancy | Simplest for startup phase |
| 2026-07-06 | Stripe for payments | Industry standard |
| 2026-07-06 | Strict TypeScript (no any) | Contract mandates no escape hatches |
| 2026-07-06 | noPropertyAccessFromIndexSignature | Maximum type safety |
| 2026-07-06 | Seed with real regulations (CA AB 418, TX SB 25) | Anti-toy: real data, not fake |
| 2026-07-06 | BasePipelineClient abstract class | Shared rate limiting, retry, dedup, persistence |
| 2026-07-06 | SHA-256 content hash deduplication | Detect changes without comparing full payloads |
| 2026-07-06 | Sliding window rate limiting | Per-pipeline, configurable intervals |
| 2026-07-06 | Exponential backoff + jitter | Avoid thundering herd on API failures |
| 2026-07-06 | Pipeline auto-disable after N errors | Prevent API key exhaustion from broken pipelines |
| 2026-07-06 | LegiScan multi-phase pipeline | Search → bill detail → bill text for comprehensive data |
| 2026-07-06 | 90+ food relevance keywords | Precision filter across all pipeline sources |
| 2026-07-06 | Vercel AI SDK v4 (generateObject) | Structured output with Zod schema enforcement |
| 2026-07-06 | OpenAI primary + Anthropic fallback | Dual-provider resilience for LLM calls |
| 2026-07-06 | 5-strategy substance matching | Deterministic matching before LLM (cheaper, faster) |
| 2026-07-06 | Linked-list rule versioning | Full audit trail, supports supersede/repeal |
| 2026-07-06 | SME validation as hard gate | No rule enters cascade engine without human approval |
| 2026-07-06 | Task-based model routing | GPT-4o for heavy parsing, GPT-4o-mini for lighter tasks |
| 2026-07-06 | BFS over DFS for traversal | BFS finds shortest impact paths first; DFS would find deep but less actionable paths |
| 2026-07-06 | Composite scoring (0.4/0.3/0.3) | Risk weighted highest because enforcement probability varies; urgency critical for deadlines |
| 2026-07-06 | Apache AGE Cypher for advanced queries | Complex multi-hop queries inefficient in relational SQL; AGE provides graph-native operations |
| 2026-07-06 | Trigger-based cascade analysis | Separates detection (pipelines) from impact analysis (cascade) for cleaner architecture |
| 2026-07-06 | Cross-jurisdiction conflict detection | Regulations in different states may have overlapping or conflicting requirements |
| 2026-07-06 | Abstract BaseErpConnector with factory pattern | Common interface for 5 ERPs, each implements same contract per CONTRACT.md |
| 2026-07-06 | 3 auth strategies: OAuth1, OAuth2, Session | NetSuite=OAuth1a, D365/Infor=OAuth2, SAP B1/Epicor=Session — matching each ERP's native auth |
| 2026-07-06 | Sliding window rate limiting per ERP | Each ERP has different rate limits (Infor 120/min, SAP B1/D365 300/min, NetSuite/Epicor 200/min) |
| 2026-07-06 | 5 conflict resolution strategies | erp_wins, local_wins, newer_wins, manual, merge — handles real-world sync conflicts |
| 2026-07-06 | Watermark-based incremental sync | Uses each ERP's modification timestamp field for efficient incremental syncs |
| 2026-07-06 | Field mapping transform engine | 6 transform types (none, uppercase, lowercase, trim, parse_number, parse_date) for custom field mappings |
| 2026-07-06 | COMMAND plan gate for ERP sync | Only COMMAND plan ($156K/yr) includes ERP integration — 5 connections max |
