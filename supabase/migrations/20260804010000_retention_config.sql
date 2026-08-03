create table if not exists retention_config (
  id integer primary key default 1,
  cart_abandon_minutes integer not null default 1440,
  file_retention_days integer not null default 3,
  stray_file_retention_hours integer not null default 2,
  login_event_retention_days integer not null default 365,
  updated_at timestamptz not null default now(),
  constraint retention_config_singleton check (id = 1)
);
