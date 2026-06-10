-- ════════════════════════════════════════════════════════════════════════════
-- Migration: standard_versions + clauses tables
-- Run once in Supabase SQL editor (Dashboard → SQL Editor → New query)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. standard_versions ─────────────────────────────────────────────────────
--    One row per published version of a standard.
--    Adding a new version (e.g. ISO 27001:2025) = INSERT only, no code change.

CREATE TABLE IF NOT EXISTS public.standard_versions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_name   TEXT        NOT NULL,           -- "ISO 27001"  "NIST CSF"
  version         TEXT        NOT NULL,           -- "2022"  "2.0"  "2025"
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  effective_date  DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (standard_name, version)
);

ALTER TABLE public.standard_versions ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all versions
CREATE POLICY "sv_select" ON public.standard_versions
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can insert (needed for the one-time auto-seeder)
CREATE POLICY "sv_insert" ON public.standard_versions
  FOR INSERT TO authenticated WITH CHECK (true);

-- Authenticated users can update (e.g. flip is_active)
CREATE POLICY "sv_update" ON public.standard_versions
  FOR UPDATE TO authenticated USING (true);


-- ── 2. clauses ───────────────────────────────────────────────────────────────
--    One row per clause / control per version.
--    FK → standard_versions; cascade-deletes when a version is removed.

CREATE TABLE IF NOT EXISTS public.clauses (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_version_id  UUID        NOT NULL REFERENCES public.standard_versions(id) ON DELETE CASCADE,
  clause_ref           TEXT        NOT NULL,   -- "4.1"  "A.5.26"  "GV.OC-01"
  clause_title         TEXT        NOT NULL,
  framework            TEXT        NOT NULL,   -- 'ISO27001' | 'NIST_CSF'
  requirement          TEXT        NOT NULL DEFAULT '',
  display_order        INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.clauses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clauses_select" ON public.clauses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "clauses_insert" ON public.clauses
  FOR INSERT TO authenticated WITH CHECK (true);


-- ── 3. Performance index ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS clauses_version_idx
  ON public.clauses (standard_version_id, display_order);


-- ════════════════════════════════════════════════════════════════════════════
-- NOTE: Data is seeded automatically by the app on first load via
-- ensureClausesSeeded() in lib/store.ts.  You do NOT need to insert rows
-- manually — just run this DDL script.
-- ════════════════════════════════════════════════════════════════════════════
