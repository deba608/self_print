-- job_files has RLS enabled with no select policy for customers, so the
-- my-jobs page's job_files query silently returns zero rows for every job —
-- filenames fall back to "Document" and there is no way to identify which
-- file a job is. Mirror the existing "customers can view own jobs" policy.
alter table public.job_files enable row level security;

drop policy if exists "customers can view own job files" on public.job_files;
create policy "customers can view own job files" on public.job_files
  for select using (
    exists (
      select 1 from public.jobs
      where jobs.id = job_files.job_id
        and jobs.customer_user_id = auth.uid()
    )
  );

drop policy if exists "staff can view all job files" on public.job_files;
create policy "staff can view all job files" on public.job_files
  for select using (
    exists (
      select 1 from public.staff_profiles
      where staff_profiles.id = auth.uid()
    )
  );

