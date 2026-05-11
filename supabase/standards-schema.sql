-- ── standards table ──────────────────────────────────────────────────────────
-- Reference table for audit standards (ISO 27001, NIST CSF, etc.)
-- Uses native columns (not the JSONB data pattern) since this is simple reference data.

create table if not exists public.standards (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  version    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.standards enable row level security;

-- All authenticated users can read standards (needed for dropdowns)
create policy "authenticated_read_standards"
  on public.standards for select
  using (auth.role() = 'authenticated');

-- Only admins can insert
create policy "admins_insert_standards"
  on public.standards for insert
  with check (public.get_my_role() = 'admin');

-- Only admins can update
create policy "admins_update_standards"
  on public.standards for update
  using (public.get_my_role() = 'admin');

-- Only admins can delete
create policy "admins_delete_standards"
  on public.standards for delete
  using (public.get_my_role() = 'admin');

-- ── Seed initial standards ────────────────────────────────────────────────────

insert into public.standards (name, version, is_active) values
  ('ISO 27001', '2022', true),
  ('NIST CSF',  '2.0',  true)
on conflict do nothing;
