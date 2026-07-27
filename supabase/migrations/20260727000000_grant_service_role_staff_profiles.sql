-- Grant service_role full access to staff_profiles and customer_profiles
-- (Supabase service_role bypasses RLS but still needs table-level GRANTs)

grant all on public.staff_profiles to service_role;
grant all on public.customer_profiles to service_role;
