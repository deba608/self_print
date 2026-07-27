alter table public.admin_login_events enable row level security;
-- Narrow the grant: service_role needs only these operations
revoke all on public.admin_login_events from service_role;
grant select, insert, delete on public.admin_login_events to service_role;

create index if not exists idx_admin_login_events_staff_logged
  on public.admin_login_events (staff_id, logged_at desc);

create index if not exists idx_admin_login_events_logged
  on public.admin_login_events (logged_at desc);
