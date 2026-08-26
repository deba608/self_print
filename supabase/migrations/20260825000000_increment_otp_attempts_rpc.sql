-- OTP brute-force protection.
-- Creates public.otps if absent: the application code (src/lib/otp.ts via
-- db-supabase.ts) reads/writes this table, but no earlier migration shipped
-- its schema, so fresh/remote projects 500 on every OTP request.
--
-- Access model: RLS enabled with NO policies — anon/authenticated are denied,
-- the server talks to this table exclusively with the service-role key.
-- The increment RPC below replaces the app-side read-modify-write that lost
-- updates under concurrent guesses and let attackers exceed max_attempts.

create table if not exists public.otps (
  id           uuid primary key default gen_random_uuid(),
  phone        text        not null,
  otp_hash     text        not null,
  purpose      text        not null default 'login',
  attempts     integer     not null default 0,
  max_attempts integer     not null default 3,
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  verified_at  timestamptz
);

alter table public.otps enable row level security;

create index if not exists otps_phone_created_idx on public.otps (phone, created_at desc);
create index if not exists otps_phone_purpose_idx on public.otps (phone, purpose);

grant all on public.otps to service_role;

create or replace function public.increment_otp_attempts(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.otps set attempts = attempts + 1 where id = p_id;
$$;

revoke all on function public.increment_otp_attempts(uuid) from public, anon, authenticated;
grant execute on function public.increment_otp_attempts(uuid) to service_role;
