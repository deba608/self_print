-- Atomic increment for OTP brute-force protection.
-- The application previously did read-modify-write from the API side, which
-- loses updates under concurrent guesses and lets an attacker exceed
-- otps.max_attempts. Call via: select increment_otp_attempts('<uuid>');

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
