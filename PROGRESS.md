# Cascada — Build Progress

> **Read this file at the start of every stage.** It tells you where you are.

---

## Current Status: STAGE 3 — RULE ENGINE ✅ COMPLETE

---

## Stage Progress

| Stage | Name | Status | Lines | Files | Completed | Checkpoint |
|-------|------|--------|-------|-------|-----------|-----------|
| 0 | Contract | ✅ COMPLETE | ~2,500 | 1 | 2026-07-06 | User approved |
| 1 | Foundation | ✅ COMPLETE | ~4,442 | 34 | 2026-07-06 | Prisma validate ✅ + tsc --noEmit ✅ |
| 2 | Data Pipelines | ✅ COMPLETE | ~7,169 | 21 | 2026-07-06 | tsc --noEmit ✅ + Real API data flows |
| 3 | Rule Engine | ✅ COMPLETE | ~4,425 | 25 | 2026-07-06 | tsc --noEmit ✅ + LLM parser + SME validation |
| 4 | Cascade Engine | ⬜ NOT STARTED | 0 | 0 | — | — |
| 5 | ERP Connectors | ⬜ NOT STARTED | 0 | 0 | — | — |
| 6 | AI Agents | ⬜ NOT STARTED | 0 | 0 | — | — |
| 7 | Workflows | ⬜ NOT STARTED | 0 | 0 | — | — |
| 8 | Dashboard + API | ⬜ NOT STARTED | 0 | 0 | — | — |
| 9 | Diagnostic | ⬜ NOT STARTED | 0 | 0 | — | — |
| 10 | Infrastructure | ⬜ NOT STARTED | 0 | 0 | — | — |
| 11 | Tests + Docs | ⬜ NOT STARTED | 0 | 0 | — | — |

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
