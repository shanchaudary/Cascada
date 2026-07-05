# Cascada — Build Progress

> **Read this file at the start of every stage.** It tells you where you are.

---

## Current Status: STAGE 0 — CONTRACT

---

## Stage Progress

| Stage | Name | Status | Lines | Files | Completed | Checkpoint |
|-------|------|--------|-------|-------|-----------|-----------|
| 0 | Contract | ✅ IN PROGRESS | ~2,500 | 1 | — | Pending user approval |
| 1 | Foundation | ⬜ NOT STARTED | 0 | 0 | — | — |
| 2 | Data Pipelines | ⬜ NOT STARTED | 0 | 0 | — | — |
| 3 | Rule Engine | ⬜ NOT STARTED | 0 | 0 | — | — |
| 4 | Cascade Engine | ⬜ NOT STARTED | 0 | 0 | — | — |
| 5 | ERP Connectors | ⬜ NOT STARTED | 0 | 0 | — | — |
| 6 | AI Agents | ⬜ NOT STARTED | 0 | 0 | — | — |
| 7 | Workflows | ⬜ NOT STARTED | 0 | 0 | — | — |
| 8 | Dashboard + API | ⬜ NOT STARTED | 0 | 0 | — | — |
| 9 | Diagnostic | ⬜ NOT STARTED | 0 | 0 | — | — |
| 10 | Infrastructure | ⬜ NOT STARTED | 0 | 0 | — | — |
| 11 | Tests + Docs | ⬜ NOT STARTED | 0 | 0 | — | — |

---

## Anti-Toy Audit Log

| Date | Stage | Check # | Result | Notes |
|------|-------|---------|--------|-------|
| — | — | — | — | No code written yet |

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
