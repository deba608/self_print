-- Add delivery role to staff_profiles and delivery_person_id to jobs,
-- plus column-level-restricted RPCs so delivery riders can only touch
-- delivery_status / delivery_person_id on jobs they own or that are unclaimed.

-- 1. Extend the role check constraint to include 'delivery'
alter table public.staff_profiles
  drop constraint if exists staff_profiles_role_check,
  add constraint staff_profiles_role_check
  check (role in ('super_admin', 'admin', 'delivery'));

-- 2. Add delivery_person_id column to jobs
alter table public.jobs
  add column if not exists delivery_person_id uuid references auth.users(id) on delete set null;

-- 3. Index for efficient pool queries
create index if not exists jobs_delivery_person_idx
  on public.jobs (delivery_status, delivery_person_id)
  where delivery_method = 'delivery';

-- 4. Column-level-restricted RPCs (security definer) so riders cannot
--    update arbitrary columns (price, status, file paths) even if RLS
--    row-check passes. The two API routes call these RPCs instead of
--    doing raw table updates.

-- claim_delivery_job: atomically set delivery_status='out_for_delivery'
-- and delivery_person_id=auth.uid() only if the job is unclaimed.
-- Returns 0 on success, 1 if already claimed, 2 if not eligible.
create or replace function public.claim_delivery_job(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Check the job is a delivery order, printed, paid, and unclaimed
  select count(*) into v_count
  from public.jobs
  where id = p_job_id
    and delivery_method = 'delivery'
    and status = 'printed'
    and paid_at is not null
    and delivery_status is null;

  if v_count = 0 then
    return 2; -- not eligible
  end if;

  -- Atomically claim: only succeeds if still unclaimed (race-safe)
  update public.jobs
  set delivery_status = 'out_for_delivery',
      delivery_person_id = auth.uid(),
      updated_at = now()
  where id = p_job_id
    and delivery_status is null;

  if not found then
    return 1; -- already claimed by another rider
  end if;

  insert into public.print_events (id, job_id, event_type, message, created_at)
  values (gen_random_uuid(), p_job_id, 'out_for_delivery',
          format('Delivery claimed by %s.', auth.uid()::text), now());

  return 0;
end;
$$;

-- complete_delivery_job: set delivery_status='delivered' only if the
-- caller owns the job (or is admin/super_admin).
-- Returns 0 on success, 1 if not owned, 2 if not eligible.
create or replace function public.complete_delivery_job(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_owner uuid;
  v_current_status text;
begin
  select role into v_role
  from public.staff_profiles
  where id = auth.uid();

  -- Admin/super_admin can override
  if v_role in ('super_admin', 'admin') then
    update public.jobs
    set delivery_status = 'delivered',
        updated_at = now()
    where id = p_job_id
      and delivery_method = 'delivery'
      and delivery_status = 'out_for_delivery';

    if not found then
      return 2; -- not eligible (not out_for_delivery)
    end if;

    insert into public.print_events (id, job_id, event_type, message, created_at)
    values (gen_random_uuid(), p_job_id, 'delivered',
            format('Delivery completed by admin %s.', auth.uid()::text), now());

    return 0;
  end if;

  -- Delivery role: must own the job and it must be out_for_delivery
  select delivery_person_id, delivery_status
  into v_owner, v_current_status
  from public.jobs
  where id = p_job_id
    and delivery_method = 'delivery';

  if v_current_status is null or v_current_status != 'out_for_delivery' then
    return 2; -- not eligible
  end if;

  if v_owner != auth.uid() then
    return 1; -- not owned by this rider
  end if;

  update public.jobs
  set delivery_status = 'delivered',
      updated_at = now()
  where id = p_job_id;

  insert into public.print_events (id, job_id, event_type, message, created_at)
  values (gen_random_uuid(), p_job_id, 'delivered',
          format('Delivery completed by rider %s.', auth.uid()::text), now());

  return 0;
end;
$$;

-- 5. RLS policies for delivery role on jobs
-- Delivery-role users can SELECT delivery-method jobs (they need to see
-- the pool). UPDATE is restricted to the RPCs above, not direct table writes.
drop policy if exists "delivery staff can view delivery jobs" on public.jobs;
create policy "delivery staff can view delivery jobs" on public.jobs
  for select using (
    public.is_staff()
    and delivery_method = 'delivery'
  );

-- Staff can still update all jobs (existing policy remains); the RPCs
-- enforce column-level restrictions via security definer.
