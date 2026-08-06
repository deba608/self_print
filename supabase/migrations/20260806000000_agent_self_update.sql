-- Agent self-update: upgrade state on agent_config + an audit trail of attempts.
alter table public.agent_config
  add column if not exists agent_version         text,
  add column if not exists agent_healthy_at      timestamptz,
  add column if not exists update_target_version text,
  add column if not exists update_status         text,
  add column if not exists update_message        text,
  add column if not exists update_started_at     timestamptz;

create table if not exists public.agent_update_events (
  id bigserial primary key,
  from_version text,
  to_version   text,
  status       text not null,
  message      text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_agent_update_events_id on agent_update_events(id desc);

alter table public.agent_update_events enable row level security;
revoke all on public.agent_update_events from anon, authenticated;
grant select on public.agent_update_events to authenticated;
grant select, insert on public.agent_update_events to service_role;
grant usage, select on sequence public.agent_update_events_id_seq to service_role;

drop policy if exists "staff read update events" on public.agent_update_events;
create policy "staff read update events" on public.agent_update_events
  for select using (public.is_staff());
-- Writes come only from the service-role key (agent/CLI); no insert policy needed.
