-- ============================================================
-- Audit Tool — Supabase Schema
-- Run this in the Supabase SQL Editor to create all tables.
-- ============================================================

-- Enable UUID extension (optional, we use TEXT ids from crypto.randomUUID())
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Audit Plans ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_plans (
  id            TEXT PRIMARY KEY,
  objective     TEXT NOT NULL DEFAULT '',
  standard      TEXT NOT NULL DEFAULT 'ISO27001',
  scope         TEXT NOT NULL DEFAULT '',
  audit_areas   TEXT NOT NULL DEFAULT '',
  lead_auditor  TEXT NOT NULL DEFAULT '',
  start_date    TEXT NOT NULL DEFAULT '',
  end_date      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'Planned',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Plan Sessions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_sessions (
  id              TEXT PRIMARY KEY,
  plan_id         TEXT NOT NULL REFERENCES audit_plans(id) ON DELETE CASCADE,
  day             INTEGER NOT NULL DEFAULT 1,
  date            TEXT NOT NULL DEFAULT '',
  time            TEXT NOT NULL DEFAULT '',
  area_of_audit   TEXT NOT NULL DEFAULT '',
  related_clauses TEXT[] NOT NULL DEFAULT '{}',
  auditee         TEXT NOT NULL DEFAULT '',
  main_auditor    TEXT NOT NULL DEFAULT '',
  ia_team         TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Checklist Items ───────────────────────────────────────────────────────────
-- session_id may reference audit_plans.id OR plan_sessions.id (hybrid)
CREATE TABLE IF NOT EXISTS checklist_items (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  framework      TEXT NOT NULL DEFAULT 'ISO27001',
  clause_ref     TEXT NOT NULL DEFAULT '',
  clause_title   TEXT NOT NULL DEFAULT '',
  requirement    TEXT NOT NULL DEFAULT '',
  question       TEXT,
  status         TEXT NOT NULL DEFAULT 'Not Assessed',
  notes          TEXT NOT NULL DEFAULT '',
  evidence       TEXT NOT NULL DEFAULT '',
  recommendation TEXT,
  due_date       TEXT,
  item_number    INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_session ON checklist_items(session_id);

-- ── Corrective Actions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corrective_actions (
  id                 TEXT PRIMARY KEY,
  checklist_item_id  TEXT NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  session_id         TEXT NOT NULL,
  clause_ref         TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  root_cause         TEXT NOT NULL DEFAULT '',
  owner              TEXT NOT NULL DEFAULT '',
  due_date           TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'Open',
  closure_notes      TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Checklist Templates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_templates (
  id          TEXT PRIMARY KEY,
  question    TEXT NOT NULL DEFAULT '',
  clause_ref  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Row Level Security (Optional — enable if using Supabase Auth)
-- ============================================================
-- ALTER TABLE audit_plans ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE plan_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE corrective_actions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
--
-- For open access (anon key, no auth):
-- CREATE POLICY "allow_all" ON audit_plans FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "allow_all" ON plan_sessions FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "allow_all" ON checklist_items FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "allow_all" ON corrective_actions FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "allow_all" ON checklist_templates FOR ALL USING (true) WITH CHECK (true);
