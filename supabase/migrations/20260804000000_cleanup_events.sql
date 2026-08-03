create table if not exists cleanup_events (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  deleted_jobs integer not null default 0,
  job_files_removed integer not null default 0,
  stray_files_removed integer not null default 0
);

create index if not exists idx_cleanup_events_ran_at on cleanup_events(ran_at desc);
