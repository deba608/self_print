-- Delivery riders must not be able to write to jobs directly.
--
-- `is_staff()` matches every staff_profiles row, including role = 'delivery',
-- so the existing "staff can update all jobs" policy let a rider PATCH
-- /rest/v1/jobs with their own session and the public anon key -- setting
-- paid_at, price_paise or status on any job, bypassing the column-restricted
-- delivery RPCs entirely. The app layer already rejects delivery in
-- requireAdmin(); this closes the same hole at the database.

create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.staff_profiles
    where id = auth.uid() and role in ('super_admin', 'admin')
  );
$$;

-- Callable only by signed-in users; it reports on the caller's own role.
revoke execute on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- No `with check` clause: per Postgres docs, when omitted on UPDATE the USING
-- expression is reused as the check, so the new row is constrained too.
drop policy if exists "staff can update all jobs" on public.jobs;
create policy "admins can update all jobs" on public.jobs
  for update using (public.is_admin());

comment on function public.is_admin() is
  'True when the caller is a super_admin or admin staff member. Delivery riders return false -- they write only through the delivery RPCs.';
