-- Cascada — PostgreSQL + Apache AGE initialization
-- This script runs on first container startup via docker-entrypoint-initdb.d

-- Load Apache AGE extension
CREATE EXTENSION IF NOT EXISTS age;

-- Load AGE into the cascada database
LOAD 'age';

-- Set the search path to include age catalog
SET search_path = ag_catalog, "$user", public;

-- Create the cascade graph schema for Apache AGE
-- Each tenant will have its own named graph within AGE
SELECT create_graph('cascade_graph');

-- Grant permissions
GRANT USAGE ON SCHEMA ag_catalog TO cascada;

-- RLS (Row Level Security) setup for multi-tenancy
-- These policies ensure tenants can only see their own data

-- Enable RLS on all tenant-scoped tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE formulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cascade_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS policy: tenant-scoped tables use the app.current_tenant_id session variable
-- Super admins bypass RLS (they have no tenant)
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.current_tenant_id', true));

CREATE POLICY user_tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY erp_connection_tenant_isolation ON erp_connections
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY ingredient_tenant_isolation ON ingredients
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY formulation_tenant_isolation ON formulations
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY product_tenant_isolation ON products
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY customer_tenant_isolation ON customers
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY supplier_tenant_isolation ON suppliers
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY cascade_graph_tenant_isolation ON cascade_graphs
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY decision_package_tenant_isolation ON decision_packages
  USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY diagnostic_tenant_isolation ON diagnostics
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- Audit logs: users can see their tenant's logs, super admins see all
CREATE POLICY audit_log_tenant_isolation ON audit_logs
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    OR current_setting('app.current_tenant_id', true) = ''
  );

-- Sync logs are accessed via erp_connections (already tenant-scoped)
-- But add RLS for direct access safety
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Tables without tenant_id are accessible to all authenticated users
-- (regulatory_sources, rules, rule_substances, pipeline_runs, llm_usage_logs)
-- These are global data, not tenant-scoped

-- Create indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingredients_tenant_id ON ingredients(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingredients_cas_number ON ingredients(cas_number) WHERE cas_number IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingredients_eenumber ON ingredients(eenumber) WHERE eenumber IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingredients_category ON ingredients(category) WHERE category IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_formulations_tenant_id ON formulations(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_formulations_status ON formulations(status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_tenant_id ON products(tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active ON products(is_active) WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regulatory_sources_jurisdiction ON regulatory_sources(jurisdiction);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regulatory_sources_status ON regulatory_sources(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regulatory_sources_type ON regulatory_sources(source_type);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rules_jurisdiction ON rules(jurisdiction);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rules_type ON rules(rule_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rules_compliance_date ON rules(compliance_date) WHERE compliance_date IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cascade_triggers_severity ON cascade_triggers(severity);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cascade_triggers_status ON cascade_triggers(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cascade_triggers_deadline ON cascade_triggers(deadline_date) WHERE deadline_date IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pipeline_runs_type ON pipeline_runs(pipeline_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_usage_logs_task ON llm_usage_logs(task_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_llm_usage_logs_tenant ON llm_usage_logs(tenant_id) WHERE tenant_id IS NOT NULL;

-- Full-text search index on regulatory source text
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_regulatory_sources_text_search
  ON regulatory_sources USING gin(to_tsvector('english', coalesce(full_text, '') || ' ' || coalesce(name, '')));

-- JSONB indexes for metadata queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ingredients_metadata ON ingredients USING gin(metadata);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rule_substances_product_scope ON rule_substances USING gin(product_scope);
