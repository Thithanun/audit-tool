-- ── profiles table ────────────────────────────────────────────────────────────
-- Mirrors auth.users; auto-populated via trigger on sign-up / invite.

create table if not exists public.profiles (
  id        uuid primary key references auth.users (id) on delete cascade,
  email     text not null,
  full_name text,
  role      text not null default 'viewer' check (role in ('admin', 'auditor', 'viewer')),
  created_at timestamptz not null default now()
);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;

-- Helper: read caller's role without a recursive policy lookup
create or replace function public.get_my_role()
returns text
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Everyone can read their own profile
create policy "users_read_own_profile"
  on public.profiles for select
  using (id = auth.uid());

-- Admins can read all profiles
create policy "admins_read_all_profiles"
  on public.profiles for select
  using (public.get_my_role() = 'admin');

-- Admins can update any profile (role changes via server action)
create policy "admins_update_profiles"
  on public.profiles for update
  using (public.get_my_role() = 'admin');

-- ── Trigger: auto-create profile on new auth user ─────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'viewer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
