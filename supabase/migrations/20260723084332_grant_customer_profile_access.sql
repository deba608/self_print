-- Supabase's Data API requires table privileges in addition to RLS policies.
-- Registration writes profiles with the server-only service role; signed-in
-- customers can read/update their own row and may create it through the
-- existing "customers can insert own profile" policy.
grant select, insert, update, delete
  on table public.customer_profiles
  to service_role;

grant select, insert, update
  on table public.customer_profiles
  to authenticated;
