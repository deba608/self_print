create table if not exists public.admin_login_events (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid references auth.users(id) on delete set null,
  email          text not null,
  ip             text,
  user_agent     text,
  browser        text,
  os             text,
  device         text,
  city           text,
  country        text,
  success        boolean not null,
  failure_reason text,
  logged_at      timestamptz not null default now()
);

grant all on public.admin_login_events to service_role;
