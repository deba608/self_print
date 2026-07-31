-- Richer delivery flow: printed → packed → picked_up → out_for_delivery → delivered.
--
-- * packed      — shop staff packed the order (admin action, optional)
-- * picked_up   — rider claimed & collected the package (claim_delivery_job)
-- * out_for_delivery — rider en route (advance_delivery_job)
-- * delivered   — handed over (advance_delivery_job)

-- claim_delivery_job: rider claims an unclaimed order. Eligible when the job
-- is a printed + paid delivery order with no rider assigned and not yet moving
-- (delivery_status null or 'packed'). Claiming marks it picked_up.
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
  select count(*) into v_count
  from public.jobs
  where id = p_job_id
    and delivery_method = 'delivery'
    and status = 'printed'
    and paid_at is not null
    and delivery_person_id is null
    and (delivery_status is null or delivery_status = 'packed');

  if v_count = 0 then
    return 2; -- not eligible
  end if;

  -- Atomic: only succeeds if still unclaimed (race-safe)
  update public.jobs
  set delivery_status = 'picked_up',
      delivery_person_id = auth.uid(),
      updated_at = now()
  where id = p_job_id
    and delivery_person_id is null;

  if not found then
    return 1; -- already claimed by another rider
  end if;

  insert into public.print_events (id, job_id, event_type, message, created_at)
  values (gen_random_uuid(), p_job_id, 'picked_up',
          format('Package picked up by rider %s.', auth.uid()::text), now());

  return 0;
end;
$$;

-- advance_delivery_job: rider moves their claimed order forward.
-- Allowed transitions: picked_up → out_for_delivery → delivered.
-- Admin/super_admin may advance any order.
-- Returns 0 on success, 1 if not owned, 2 if invalid transition.
create or replace function public.advance_delivery_job(p_job_id uuid, p_next text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_owner uuid;
  v_current text;
begin
  if p_next not in ('out_for_delivery', 'delivered') then
    return 2;
  end if;

  select delivery_person_id, delivery_status
  into v_owner, v_current
  from public.jobs
  where id = p_job_id
    and delivery_method = 'delivery';

  if v_current is null
     or (p_next = 'out_for_delivery' and v_current != 'picked_up')
     or (p_next = 'delivered' and v_current != 'out_for_delivery') then
    return 2; -- invalid transition
  end if;

  select role into v_role
  from public.staff_profiles
  where id = auth.uid();

  if v_role not in ('super_admin', 'admin') and v_owner != auth.uid() then
    return 1; -- not owned by this rider
  end if;

  update public.jobs
  set delivery_status = p_next,
      updated_at = now()
  where id = p_job_id;

  insert into public.print_events (id, job_id, event_type, message, created_at)
  values (gen_random_uuid(), p_job_id, p_next,
          format('Delivery advanced to %s by %s.', p_next, auth.uid()::text), now());

  return 0;
end;
$$;

-- Superseded by advance_delivery_job.
drop function if exists public.complete_delivery_job(uuid);
