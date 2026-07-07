-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('DIAGNOSTIC', 'SCOUT', 'PRO', 'COMMAND');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'TENANT_ADMIN', 'COMPLIANCE', 'EXECUTIVE', 'VIEWER');

-- CreateEnum
CREATE TYPE "ErpType" AS ENUM ('NETSUITE', 'SAP_B1', 'DYNAMICS_365_BC', 'INFOR_M3', 'EPICOR_P21');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'SYNCING', 'ERROR', 'RATE_LIMITED');

-- CreateEnum
CREATE TYPE "FormulationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RETAILER', 'DISTRIBUTOR', 'FOODSERVICE', 'PRIVATE_LABEL', 'DIRECT_TO_CONSUMER');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('STATE_BILL', 'FEDERAL_BILL', 'FDA_RULE', 'FDA_GUIDANCE', 'FDA_PROPOSED_RULE', 'FEDERAL_REGISTER_NOTICE', 'RETAILER_MANDATE', 'INTERNATIONAL_REGULATION');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('DETECTED', 'PROCESSING', 'PARSED', 'SME_REVIEW', 'SME_APPROVED', 'SME_REJECTED', 'ACTIVE', 'REPEALED', 'SUPERSEDED', 'ENJOINDED');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('BAN', 'WARNING_LABEL', 'DISCLOSURE', 'PHASE_OUT', 'CONCENTRATION_LIMIT', 'REPORTING', 'CERTIFICATION', 'INGREDIENT_REVIEW', 'MARKET_WITHDRAWAL');

-- CreateEnum
CREATE TYPE "CascadeNodeType" AS ENUM ('INGREDIENT', 'FORMULATION', 'PRODUCT', 'CUSTOMER', 'REGULATION', 'RETAILER_REQUIREMENT', 'SUPPLIER');

-- CreateEnum
CREATE TYPE "CascadeEdgeType" AS ENUM ('CONTAINS', 'PRODUCED_FROM', 'SOLD_TO', 'SUBJECT_TO', 'REQUIRES', 'SUPPLIED_BY', 'SUPERSEDES', 'CONFLICTS_WITH');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('NEW_REGULATION', 'REGULATION_AMENDMENT', 'REGULATION_REPEAL', 'RETAILER_MANDATE_CHANGE', 'SUPPLIER_DISRUPTION', 'INGREDIENT_SHORTAGE');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "TriggerStatus" AS ENUM ('DETECTED', 'ANALYZING', 'IMPACT_ASSESSED', 'DECISION_PACKAGE_READY', 'DECISION_MADE', 'WORKFLOW_STARTED', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ImpactType" AS ENUM ('REFORMULATION_REQUIRED', 'LABEL_CHANGE_REQUIRED', 'PRODUCT_WITHDRAWAL', 'REFORMULATION_COST', 'SUPPLY_CHAIN_DISRUPTION', 'CUSTOMER_SPEC_VIOLATION', 'REGULATORY_PENALTY', 'SHELF_SPACE_LOSS', 'MARKET_ACCESS_LOSS');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PENDING', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "DiagnosticStatus" AS ENUM ('REQUESTED', 'PAID', 'PROCESSING', 'COMPLETED', 'DELIVERED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'DIAGNOSTIC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "erpType" "ErpType" NOT NULL,
    "connectionName" TEXT NOT NULL,
    "connectionString" TEXT NOT NULL,
    "authConfig" JSONB NOT NULL,
    "syncState" JSONB NOT NULL,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "fieldMappings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "erpConnectionId" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "recordsTotal" INTEGER NOT NULL,
    "recordsSuccess" INTEGER NOT NULL,
    "recordsFailed" INTEGER NOT NULL,
    "errorDetails" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "duration" INTEGER,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "erpId" TEXT,
    "name" TEXT NOT NULL,
    "alternateNames" TEXT[],
    "casNumber" TEXT,
    "eenumber" TEXT,
    "category" TEXT,
    "isSynthetic" BOOLEAN,
    "sourceType" TEXT,
    "allergenFlags" TEXT[],
    "supplierIds" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "erpId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "FormulationStatus" NOT NULL DEFAULT 'DRAFT',
    "batchSize" DOUBLE PRECISION,
    "batchSizeUnit" TEXT,
    "totalCost" DECIMAL(12,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulation_items" (
    "id" TEXT NOT NULL,
    "formulationId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(12,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "percentage" DECIMAL(8,4),
    "isAlternate" BOOLEAN NOT NULL DEFAULT false,
    "replacesIngredientId" TEXT,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "formulation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substitution_options" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "originalIngredientId" TEXT NOT NULL,
    "substituteIngredientId" TEXT NOT NULL,
    "substitutionCost" DECIMAL(12,4),
    "feasibilityScore" DECIMAL(3,2),
    "sensoryImpact" TEXT,
    "shelfLifeImpact" TEXT,
    "regulatoryRisk" TEXT,
    "notes" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "substitution_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "erpId" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "markets" TEXT[],
    "retailers" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "annualVolume" DECIMAL(12,2),
    "annualRevenue" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_formulations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "formulationId" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_formulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "erpId" TEXT,
    "name" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "requirements" JSONB,
    "contactEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_products" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "specVersion" TEXT,
    "specRequirements" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "customer_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "erpId" TEXT,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT,
    "certifications" TEXT[],
    "ingredientIds" TEXT[],
    "riskScore" DECIMAL(3,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_sources" (
    "id" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "status" "SourceStatus" NOT NULL,
    "introducedDate" TIMESTAMP(3),
    "enactedDate" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "fullText" TEXT,
    "rawApiResponse" JSONB,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "ruleType" "RuleType" NOT NULL,
    "description" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "complianceDate" TIMESTAMP(3),
    "gracePeriodDays" INTEGER,
    "penaltyType" TEXT,
    "penaltyAmount" DECIMAL(12,2),
    "exemptions" JSONB,
    "notes" TEXT,
    "smeValidatedBy" TEXT,
    "smeValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_substances" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ingredientId" TEXT,
    "substanceName" TEXT NOT NULL,
    "substanceType" TEXT NOT NULL,
    "casNumber" TEXT,
    "eenumber" TEXT,
    "threshold" DECIMAL(12,6),
    "thresholdUnit" TEXT,
    "productScope" JSONB,
    "isMatched" BOOLEAN NOT NULL DEFAULT false,
    "matchConfidence" DECIMAL(3,2),
    "matchMethod" TEXT,

    CONSTRAINT "rule_substances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cascade_graphs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "edgeCount" INTEGER NOT NULL DEFAULT 0,
    "lastRebuiltAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cascade_graphs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cascade_nodes" (
    "id" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,
    "nodeType" "CascadeNodeType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "properties" JSONB NOT NULL,
    "riskScore" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cascade_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cascade_edges" (
    "id" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "edgeType" "CascadeEdgeType" NOT NULL,
    "properties" JSONB NOT NULL,
    "strength" DECIMAL(3,2),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cascade_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cascade_triggers" (
    "id" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "triggerType" "TriggerType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "affectedNodeIds" TEXT[],
    "cascadeDepth" INTEGER NOT NULL,
    "cascadeBreadth" INTEGER NOT NULL,
    "totalSkusAffected" INTEGER NOT NULL,
    "estimatedCostMin" DECIMAL(12,2),
    "estimatedCostMax" DECIMAL(12,2),
    "deadlineDate" TIMESTAMP(3),
    "conflictDates" JSONB,
    "status" "TriggerStatus" NOT NULL DEFAULT 'DETECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cascade_triggers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cascade_impacts" (
    "id" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "impactType" "ImpactType" NOT NULL,
    "description" TEXT NOT NULL,
    "financialImpact" DECIMAL(12,2),
    "timelineImpact" INTEGER,
    "reformRequired" BOOLEAN NOT NULL DEFAULT false,
    "reformCost" DECIMAL(12,2),
    "reformOptions" JSONB,
    "priority" INTEGER,

    CONSTRAINT "cascade_impacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_packages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "mandateSummary" TEXT NOT NULL,
    "affectedSkuList" JSONB NOT NULL,
    "complianceTimeline" JSONB NOT NULL,
    "reformulationOptions" JSONB NOT NULL,
    "prioritization" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "deliveryMethod" TEXT,
    "decision" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNotes" TEXT,

    CONSTRAINT "decision_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "decisionPackageId" TEXT,
    "workflowType" TEXT NOT NULL,
    "temporalWorkflowId" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" TEXT,
    "steps" JSONB NOT NULL,
    "assignedTo" TEXT[],
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorDetail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnostics" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "status" "DiagnosticStatus" NOT NULL DEFAULT 'REQUESTED',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "formData" JSONB NOT NULL,
    "resultData" JSONB,
    "reportUrl" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnostics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_usage_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "taskType" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "pipelineType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsProcessed" INTEGER NOT NULL,
    "recordsNew" INTEGER NOT NULL,
    "recordsUpdated" INTEGER NOT NULL,
    "recordsFailed" INTEGER NOT NULL,
    "errorDetail" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "duration" INTEGER,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_tenantId_name_key" ON "ingredients"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "formulations_tenantId_erpId_version_key" ON "formulations"("tenantId", "erpId", "version");

-- CreateIndex
CREATE INDEX "substitution_options_originalIngredientId_idx" ON "substitution_options"("originalIngredientId");

-- CreateIndex
CREATE INDEX "substitution_options_substituteIngredientId_idx" ON "substitution_options"("substituteIngredientId");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_sku_key" ON "products"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_name_key" ON "customers"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tenantId_name_key" ON "suppliers"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rules_sourceId_version_key" ON "rules"("sourceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "cascade_nodes_graphId_nodeType_entityId_key" ON "cascade_nodes"("graphId", "nodeType", "entityId");

-- CreateIndex
CREATE INDEX "cascade_impacts_triggerId_idx" ON "cascade_impacts"("triggerId");

-- CreateIndex
CREATE INDEX "cascade_impacts_nodeId_idx" ON "cascade_impacts"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "decision_packages_triggerId_key" ON "decision_packages"("triggerId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_connections" ADD CONSTRAINT "erp_connections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_erpConnectionId_fkey" FOREIGN KEY ("erpConnectionId") REFERENCES "erp_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulation_items" ADD CONSTRAINT "formulation_items_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "formulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulation_items" ADD CONSTRAINT "formulation_items_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitution_options" ADD CONSTRAINT "substitution_options_originalIngredientId_fkey" FOREIGN KEY ("originalIngredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substitution_options" ADD CONSTRAINT "substitution_options_substituteIngredientId_fkey" FOREIGN KEY ("substituteIngredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_formulations" ADD CONSTRAINT "product_formulations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_formulations" ADD CONSTRAINT "product_formulations_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "formulations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_products" ADD CONSTRAINT "customer_products_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_products" ADD CONSTRAINT "customer_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "regulatory_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_substances" ADD CONSTRAINT "rule_substances_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_substances" ADD CONSTRAINT "rule_substances_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_graphs" ADD CONSTRAINT "cascade_graphs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_nodes" ADD CONSTRAINT "cascade_nodes_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "cascade_graphs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_edges" ADD CONSTRAINT "cascade_edges_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "cascade_graphs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_edges" ADD CONSTRAINT "cascade_edges_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "cascade_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_edges" ADD CONSTRAINT "cascade_edges_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "cascade_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_triggers" ADD CONSTRAINT "cascade_triggers_graphId_fkey" FOREIGN KEY ("graphId") REFERENCES "cascade_graphs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_triggers" ADD CONSTRAINT "cascade_triggers_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_impacts" ADD CONSTRAINT "cascade_impacts_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "cascade_triggers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cascade_impacts" ADD CONSTRAINT "cascade_impacts_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "cascade_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_packages" ADD CONSTRAINT "decision_packages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_packages" ADD CONSTRAINT "decision_packages_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "cascade_triggers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnostics" ADD CONSTRAINT "diagnostics_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
