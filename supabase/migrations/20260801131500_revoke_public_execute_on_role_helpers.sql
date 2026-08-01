-- Postgres grants EXECUTE to the PUBLIC pseudo-role by default on function
-- creation. Revoking from `anon` alone doesn't remove it, since `anon`
-- inherits through PUBLIC -- that's why the advisor kept flagging is_admin()
-- as anon-callable even after the previous migration's explicit revoke.
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_staff() from public;
revoke execute on function public.is_super_admin() from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
