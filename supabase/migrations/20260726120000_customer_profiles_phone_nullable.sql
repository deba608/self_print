-- Google OAuth signups have no phone at signup time (unlike email/password
-- signup, which collects it in the form). Relax the not-null constraint so
-- the callback can create a profile row immediately; the account page
-- already lets customers add a phone number later.
alter table public.customer_profiles alter column phone drop not null;
