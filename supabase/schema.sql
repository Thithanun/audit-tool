-- Audit Tool schema
-- Tables use { id: UUID, data: JSONB } pattern.
-- plan_sessions also has plan_id at top level for indexed filtering.

CREATE TABLE IF NOT EXISTS audit_plans (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS plan_sessions (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES audit_plans(id) ON DELETE CASCADE,
  data    JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS corrective_actions (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}'
);

-- Disable RLS — internal tool, no per-user access control needed.
ALTER TABLE audit_plans        DISABLE ROW LEVEL SECURITY;
ALTER TABLE plan_sessions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items    DISABLE ROW LEVEL SECURITY;
ALTER TABLE corrective_actions DISABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates DISABLE ROW LEVEL SECURITY;
