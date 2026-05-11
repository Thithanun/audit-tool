-- ── Add must_change_password to profiles ─────────────────────────────────────
-- Run this once in Supabase SQL Editor (Database → SQL Editor → New query).
--
-- Default TRUE so every new profile row starts with must_change_password = true.
-- Existing users (admins etc.) are set to FALSE immediately after the ALTER.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT true;

-- Existing users do not need to change their password
UPDATE public.profiles SET must_change_password = false;
