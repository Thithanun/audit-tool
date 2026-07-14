-- ─────────────────────────────────────────────────────────────────────────────
-- init.sql  —  Bootstrap database for Audit Tool (On-Premise)
-- รันโดยอัตโนมัติเมื่อ PostgreSQL container เริ่มต้นครั้งแรก
-- NOTE: GoTrue/Storage API only run table-level migrations — they do NOT create
--       their own schema. The "auth" and "storage" schemas must exist beforehand,
--       or migrations fail with "no schema has been selected to create in".
--
-- Table definitions below are copied from the app's own schema source of truth:
--   supabase/schema.sql, supabase/standards-schema.sql, supabase/auth-schema.sql,
--   supabase/add-must-change-password.sql, supabase/migrations/20260610_standard_versions.sql
-- Keep this file in sync with those whenever the app schema changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Roles required by PostgREST + GoTrue ──────────────────────────────────────
DO $$
BEGIN
  -- anon role (unauthenticated API access, controlled by RLS)
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;

  -- authenticated role (logged-in users)
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;

  -- service_role (bypasses RLS — server-side only)
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;

  -- authenticator (PostgREST login role — switches to anon/authenticated)
  -- password is substituted by install.sh from POSTGRES_PASSWORD in .env
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD '__AUTHENTICATOR_PASSWORD__';
  END IF;
  GRANT anon        TO authenticator;
  GRANT authenticated TO authenticator;
  GRANT service_role  TO authenticator;

  -- supabase_auth_admin (used by GoTrue)
  -- password is substituted by install.sh from GOTRUE_DB_PASSWORD in .env
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOINHERIT LOGIN PASSWORD '__GOTRUE_DB_PASSWORD__' CREATEROLE;
  END IF;

  -- supabase_storage_admin (used by Storage API)
  -- password is substituted by install.sh from POSTGRES_PASSWORD in .env
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin NOINHERIT LOGIN PASSWORD '__STORAGE_ADMIN_PASSWORD__';
  END IF;
END
$$;

-- ── Schemas required by GoTrue (auth) and Storage API (storage) ────────────────
-- These services only run table-level migrations against an existing schema —
-- they do not create the schema itself, unlike a hosted Supabase project where
-- this is done by the platform before either service ever starts.
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT ALL   ON SCHEMA auth TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres;

CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;
GRANT ALL   ON SCHEMA storage TO supabase_storage_admin;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role, postgres;

-- Both services' migration engines re-attempt "CREATE SCHEMA IF NOT EXISTS ..."
-- of their own accord on every startup (even though init.sql already created the
-- schema above) — that statement itself requires database-level CREATE privilege,
-- not just schema ownership, or it fails with "permission denied for database".
GRANT CREATE ON DATABASE postgres TO supabase_auth_admin;
GRANT CREATE ON DATABASE postgres TO supabase_storage_admin;

-- ── auth.uid() / auth.role() / auth.email() ──────────────────────────────────
-- On a hosted Supabase project these helper functions are created by the
-- platform itself before GoTrue/PostgREST ever start. Self-hosting doesn't get
-- them for free — RLS policies that call auth.uid() etc. will fail with
-- "function auth.uid() does not exist" without them, aborting the rest of this
-- init script (docker-entrypoint-initdb.d stops on the first error).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT
      COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT
      COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
      )::text
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT
      COALESCE(
        NULLIF(current_setting('request.jwt.claim.email', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
      )::text
$$;

-- GoTrue's own migrations ALSO create auth.uid()/auth.role() on startup (running
-- as supabase_auth_admin) via "CREATE OR REPLACE FUNCTION" — which requires being
-- the function's owner. Transfer ownership now so that later replacement by
-- GoTrue succeeds instead of failing with "must be owner of function uid".
ALTER FUNCTION auth.uid()   OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role()  OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.email() OWNER TO supabase_auth_admin;

GRANT EXECUTE ON FUNCTION auth.uid()   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.role()  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.email() TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- App schema — mirrors supabase/*.sql exactly (see header note)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── profiles ──────────────────────────────────────────────────────────────────
-- Mirrors auth.users; auto-populated via trigger on sign-up / invite.
-- NOTE: no FK to auth.users here — that table doesn't exist yet at this point
-- (GoTrue creates it after this script runs). install.sh adds the FK constraint
-- in STEP 10, once GoTrue is confirmed healthy.
CREATE TABLE IF NOT EXISTS public.profiles (
  id                   UUID        PRIMARY KEY,
  email                TEXT        NOT NULL,
  name                 TEXT,
  role                 TEXT        NOT NULL DEFAULT 'viewer'
                                   CHECK (role IN ('admin', 'auditor', 'viewer')),
  must_change_password BOOLEAN     NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "users_read_own_profile"  ON public.profiles;
DROP POLICY IF EXISTS "admins_read_all_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admins_update_profiles"   ON public.profiles;

CREATE POLICY "users_read_own_profile"
  ON public.profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "admins_read_all_profiles"
  ON public.profiles FOR SELECT USING (public.get_my_role() = 'admin');

CREATE POLICY "admins_update_profiles"
  ON public.profiles FOR UPDATE USING (public.get_my_role() = 'admin');

-- ── Trigger function: auto-create profile on new auth user ─────────────────────
-- NOTE: the trigger itself (on auth.users) is created by install.sh STEP 10,
-- once GoTrue has created the auth.users table.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'viewer')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── standards ─────────────────────────────────────────────────────────────────
-- Reference table for audit standards (ISO 27001, NIST CSF, etc.)
CREATE TABLE IF NOT EXISTS public.standards (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  version    TEXT,
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No-auth mode: RLS disabled — anon role must be able to read reference data.
ALTER TABLE public.standards DISABLE ROW LEVEL SECURITY;

INSERT INTO public.standards (name, version, is_active) VALUES
  ('ISO 27001', '2022', true),
  ('NIST CSF',  '2.0',  true)
ON CONFLICT DO NOTHING;

-- ── standard_versions + clauses ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.standard_versions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_name   TEXT        NOT NULL,
  version         TEXT        NOT NULL,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  effective_date  DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (standard_name, version)
);

-- No-auth mode: anon role must read/seed standard_versions.
ALTER TABLE public.standard_versions DISABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.clauses (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_version_id  UUID        NOT NULL REFERENCES public.standard_versions(id) ON DELETE CASCADE,
  clause_ref           TEXT        NOT NULL,
  clause_title         TEXT        NOT NULL,
  framework            TEXT        NOT NULL,
  requirement          TEXT        NOT NULL DEFAULT '',
  display_order        INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No-auth mode: anon role must read/seed clauses.
ALTER TABLE public.clauses DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS clauses_version_idx
  ON public.clauses (standard_version_id, display_order);

-- ── audit_plans / plan_sessions / checklist_items / corrective_actions /
--    checklist_templates ───────────────────────────────────────────────────────
-- { id: UUID, data: JSONB } pattern. RLS disabled — internal tool, no
-- per-user access control needed at the row level (matches supabase/schema.sql).
CREATE TABLE IF NOT EXISTS public.audit_plans (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.plan_sessions (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID REFERENCES public.audit_plans(id) ON DELETE CASCADE,
  data    JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.checklist_items (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.corrective_actions (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}'
);

ALTER TABLE public.audit_plans        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_sessions      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.corrective_actions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_templates DISABLE ROW LEVEL SECURITY;

-- ── Grants for PostgREST roles ───────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
