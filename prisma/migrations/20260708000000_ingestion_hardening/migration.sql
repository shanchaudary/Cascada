-- Regulatory ingestion hardening: preserve source evidence, enforce source
-- dedupe at the database layer, and classify non-regulatory reference data.

ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'REFERENCE_DATA';

ALTER TABLE "regulatory_sources"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "summary" TEXT,
  ADD COLUMN "citationUrl" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "sourceAgency" TEXT,
  ADD COLUMN "documentType" TEXT,
  ADD COLUMN "relevantCategories" JSONB,
  ADD COLUMN "matchMetadata" JSONB;

CREATE UNIQUE INDEX "regulatory_sources_sourceType_sourceId_key"
  ON "regulatory_sources"("sourceType", "sourceId");
