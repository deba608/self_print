-- Task 4: user management — staff_profiles, customer_profiles, jobs.customer_user_id, RLS
-- Design decision: staff_profiles and customer_profiles rows are populated by application
-- code at signup/invite time (not by DB triggers on auth.users) — there is no
-- on-auth-user-created trigger here by design.

create table if not exists public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null check (role in ('super_admin', 'admin')),
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  phone text not null,
  created_at timestamptz not null default now()
);

alter table public.jobs
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null;

create index if not exists jobs_customer_user_id_idx on public.jobs(customer_user_id);

alter table public.jobs enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.customer_profiles enable row level security;

create or replace function public.is_staff()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from public.staff_profiles where id = auth.uid());
$$;

create or replace function public.is_super_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (select 1 from public.staff_profiles where id = auth.uid() and role = 'super_admin');
$$;

drop policy if exists "staff can read all staff profiles" on public.staff_profiles;
create policy "staff can read all staff profiles" on public.staff_profiles
  for select using (public.is_staff());
drop policy if exists "super admins can insert staff profiles" on public.staff_profiles;
create policy "super admins can insert staff profiles" on public.staff_profiles
  for insert with check (public.is_super_admin());
drop policy if exists "super admins can delete staff profiles" on public.staff_profiles;
create policy "super admins can delete staff profiles" on public.staff_profiles
  for delete using (public.is_super_admin());

drop policy if exists "customers can read own profile" on public.customer_profiles;
create policy "customers can read own profile" on public.customer_profiles
  for select using (auth.uid() = id);
drop policy if exists "customers can update own profile" on public.customer_profiles;
-- No `with check` clause: per Postgres docs, when omitted on UPDATE the USING
-- expression is reused as the check, so this still restricts updates to the owner's row.
create policy "customers can update own profile" on public.customer_profiles
  for update using (auth.uid() = id);
drop policy if exists "customers can insert own profile" on public.customer_profiles;
create policy "customers can insert own profile" on public.customer_profiles
  for insert with check (auth.uid() = id);

drop policy if exists "customers can view own jobs" on public.jobs;
create policy "customers can view own jobs" on public.jobs
  for select using (auth.uid() = customer_user_id);
drop policy if exists "staff can view all jobs" on public.jobs;
create policy "staff can view all jobs" on public.jobs
  for select using (public.is_staff());
drop policy if exists "staff can update all jobs" on public.jobs;
-- No `with check` clause: per Postgres docs, when omitted on UPDATE the USING
-- expression is reused as the check, so staff-only access still applies to the new row.
create policy "staff can update all jobs" on public.jobs
  for update using (public.is_staff());
