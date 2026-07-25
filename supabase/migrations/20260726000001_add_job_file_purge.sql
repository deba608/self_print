-- Privacy retention: track when an uploaded file's bytes were deleted.
-- job_files rows (and the parent job row) are kept forever for order
-- history/receipts; only storage_path + purged_at change once purged.
alter table public.job_files
  add column if not exists purged_at timestamptz;
