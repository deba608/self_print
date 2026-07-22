# User Management System — Plan

Scope: staff/admin accounts (multi-user, roles) + customer accounts (register/login/history). Register, login, forgot password, session handling. Optimize for $0 cost at current scale.

## Current state (for reference)

- Admin: single hardcoded user in `admin_users` table. Custom auth: PBKDF2 password hash (`src/lib/security.ts`) + HMAC-signed session cookie (`SESSION_COOKIE`, 12h expiry). No roles, no password reset, no email.
- Customers: fully anonymous. Job tracked by random token only (per CLAUDE.md: "No customer authentication required" — this plan changes that).
- DB: dual — SQLite local (`db.ts`), Supabase Postgres prod (`db-supabase.ts`), auto-selected by env vars.

Building forgot-password, email verification, rate-limiting, and session refresh by hand (current approach) is real work and a real attack surface (token replay, email deliverability, brute force). Since prod DB is already Supabase, **use Supabase Auth** instead of extending the homegrown system — it's free at this scale and removes ~80% of the code you'd otherwise write and maintain.

## Recommended stack (all free tier)

| Need | Tool | Cost | Why |
|---|---|---|---|
| Auth core (register/login/sessions/JWT) | **Supabase Auth** | Free — 50,000 MAU | Already using Supabase for prod DB. One less system to run. Handles password hashing, JWT issuance/refresh, session cookies via `@supabase/ssr`. |
| Forgot password / email verification | Supabase Auth built-in (`resetPasswordForEmail`, `signUp` email confirm) | Free, but low send rate on default Supabase SMTP (~a few/hour) — fine for testing, **not** for real users | Use custom SMTP (below) once live |
| Transactional email (reset/verify links) | **Resend** (or Brevo) via custom SMTP in Supabase Auth settings | Free — Resend: 3,000 emails/mo, 100/day; Brevo: 300/day | Plug into Supabase Auth's "Custom SMTP" setting — no code needed, Supabase calls it automatically |
| Staff roles (owner/staff/etc) | Postgres table `staff_roles(user_id, role)` + Supabase `app_metadata` claim | Free (already have Postgres) | Don't roll your own RBAC framework — one lookup table + a Postgres RLS policy is enough at this scale |
| Row-level access control (customers only see own jobs) | **Supabase RLS policies** on `jobs` table | Free | Enforced in DB, not just app code — can't be bypassed by a bug in a route handler |
| Bot/abuse protection on signup + login | **Supabase Auth built-in rate limiting** (already on by default) + optional hCaptcha (free tier, Supabase has native hCaptcha hook) | Free | Skip hCaptcha initially; add only if you see abuse |
| Local dev auth (no internet / no Supabase project) | **Supabase CLI local stack** (`supabase start`, Docker) — includes local Auth server + Inbucket fake-SMTP inbox for testing reset emails | Free | Keeps `npm run dev` fully offline-capable, mirrors prod |

No cost at any point in this plan unless you exceed 50k MAU or 3k emails/month — both far beyond a single Xerox shop's traffic.

## Why not roll your own further

- Custom forgot-password = generate token, store hash + expiry in DB, send email yourself (need an email provider anyway), build a reset-token verify endpoint, handle token reuse/expiry edge cases. Supabase Auth already does all of this correctly (it's widely audited, used by huge number of prod apps).
- Custom sessions = you already hand-rolled one (HMAC cookie); it works but has no refresh-token rotation, no revocation list, no multi-device sign-out. Supabase Auth sessions (JWT + refresh token) get you this for free via `@supabase/ssr`.
- Keep your PBKDF2/HMAC code only as a fallback reference or delete after migration — don't maintain two auth systems long-term.

## Data model changes

```sql
-- Extends existing Supabase schema (see supabase skill before running any migration)

-- Supabase's built-in auth.users table is the source of truth for credentials.
-- App-level profile/role data goes in your own tables, keyed by auth.users.id.

create table staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('owner','staff')) default 'staff',
  created_at timestamptz default now()
);

create table customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz default now()
);

-- jobs table: add nullable owner link. Nullable so anonymous/guest jobs
-- (no login) keep working during and after rollout — don't force a breaking change.
alter table jobs add column customer_user_id uuid references auth.users(id);

-- RLS: customers only see their own jobs; staff see everything.
alter table jobs enable row level security;

create policy "customers read own jobs" on jobs
  for select using (customer_user_id = auth.uid());

create policy "staff read all jobs" on jobs
  for select using (
    exists (select 1 from staff_profiles where user_id = auth.uid())
  );
```

Guest checkout stays supported: `customer_user_id` is nullable, token-based tracking (current flow) keeps working for anyone who doesn't want an account. Login is additive — lets returning customers see history, not a requirement to use the site.

## Implementation phases

### Phase 0 — Supabase Auth setup (no app code)
1. In Supabase dashboard: enable Email provider (should be on by default).
2. Auth → Settings → set Site URL + Redirect URLs to your prod domain + `localhost:3000` for dev.
3. Auth → Settings → SMTP: sign up for Resend (free), get SMTP credentials, plug into Supabase custom SMTP. Without this, password-reset/verification emails are rate-limited too hard for real use.
4. Auth → Email templates: customize "Confirm signup" and "Reset password" templates (branding, shop name).
5. `supabase` CLI: `supabase init` + `supabase start` for local dev stack (Docker required) so auth works offline in dev, mirroring prod.

### Phase 1 — Install & wire Supabase Auth in Next.js
1. `npm install @supabase/ssr @supabase/supabase-js`
2. Create `src/lib/supabase/server.ts` and `src/lib/supabase/client.ts` (server/browser clients per `@supabase/ssr` docs — use `Skill("supabase")` for current-version setup, API shifts between versions).
3. Add middleware (`src/middleware.ts`) to refresh the Supabase session cookie on every request (standard `@supabase/ssr` pattern).

### Phase 2 — Customer register/login/forgot-password (public-facing)
1. `/account/register` — email + password form → `supabase.auth.signUp()`. On success, insert row into `customer_profiles`.
2. `/account/login` — `supabase.auth.signInWithPassword()`.
3. `/account/forgot-password` — `supabase.auth.resetPasswordForEmail(email, { redirectTo: ".../account/reset-password" })`.
4. `/account/reset-password` — reads recovery session from URL, calls `supabase.auth.updateUser({ password })`.
5. `/account` (dashboard) — list jobs where `customer_user_id = auth.uid()` (RLS enforces this automatically, just query `jobs`).
6. Upload flow: if logged in, stamp `customer_user_id` on job creation; if not, leave null (unchanged guest flow).

### Phase 3 — Staff/admin multi-user + roles
1. Migrate off `admin_users` + custom cookie auth: staff sign in via same Supabase Auth (`/admin/login` → `signInWithPassword`).
2. `requireAdmin()` in `src/lib/security.ts` rewritten to: read Supabase session server-side → check `staff_profiles` for a row → return profile or null. Delete the PBKDF2/HMAC session code once cut over.
3. Roles: `owner` can manage other staff (invite/remove), `staff` cannot. Gate admin-only routes (pricing config, staff management) on `role = 'owner'`.
4. Inviting staff: owner enters email in admin UI → server calls Supabase Admin API `supabase.auth.admin.inviteUserByEmail()` (needs service role key, already have it for agent/db-supabase) → they get a set-password email.

### Phase 4 — Cleanup & hardening
1. Remove `admin_users` table, `hashSecret`/`verifySecret`/`makeSession` from `security.ts` once staff fully migrated (or keep as documented legacy fallback for the SQLite-only local path, per your call).
2. Confirm RLS policies block cross-customer job access (test with two accounts).
3. Rate-limit check: try 10 rapid login attempts, confirm Supabase's default throttling kicks in.
4. Update `CLAUDE.md`: "No customer authentication required" is no longer true — replace with a line describing optional accounts + guest flow, and document the new admin login path (remove `admin`/`1234` default-credentials section once staff auth replaces it).

## Open decisions to make before starting

- Do staff still need a "fallback" login path when running pure-SQLite local dev without any Supabase project configured? Simplest: require Supabase CLI local stack for anyone doing auth-related dev; keep old system only for non-auth-related local dev if you want zero Docker dependency. Pick one, don't maintain both indefinitely.
- Should customer registration be mandatory or optional? Plan above assumes optional (guest checkout preserved) — confirm that's still desired before Phase 2.
- Social login (Google, etc)? Supabase Auth supports it free, but adds OAuth app setup per provider — skip unless requested.

## Testing checklist

- [ ] New customer can register, gets confirmation email (check Resend/Inbucket), confirms, logs in
- [ ] Forgot password round-trip: request → email → reset link → new password → login works
- [ ] Guest (no account) upload still works end-to-end, unaffected
- [ ] Logged-in customer sees only their own jobs in `/account`, not others'
- [ ] Staff login works; `owner` can invite staff, `staff` cannot
- [ ] Old admin/1234 login is fully decommissioned (returns error, not silent bypass)
- [ ] Rate limiting: rapid failed logins get throttled, not silently allowed
