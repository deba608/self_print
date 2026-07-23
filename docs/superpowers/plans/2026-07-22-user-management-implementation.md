# User Management Implementation Plan (Supabase Auth)

Supersedes the narrative plan at `docs/superpowers/plans/2026-07-22-user-management-system.md` — this is the task-structured version for subagent-driven execution.

## Context

Self_Print currently has a single hardcoded admin login (`admin`/`1234`, `admin_users` table, custom PBKDF2+HMAC session cookie) and fully anonymous customers (token-based tracking only). This plan replaces that with Supabase Auth: multiple staff accounts with roles, optional customer accounts (guest upload stays supported), and a real forgot-password flow — at effectively zero added cost, reusing the Supabase project already in use for prod DB/storage.

## Locked decisions (resolved with user — do not re-litigate)

1. **Hard cutover.** Old `admin_users` table, PBKDF2/HMAC session code, and `admin`/`1234` login are deleted once staff accounts work. No parallel fallback period.
2. **First super-admin email:** `pdebashish608@gmail.com`. This person must be created manually in Supabase Auth (Dashboard → Authentication → Add User) with a `staff_profiles` row `role='super_admin'` before Task 7/8 can be tested end-to-end.
3. **Roles are `super_admin` and `admin`** (not "owner"/"staff" — matches how the user described it). `super_admin` can invite/remove `admin` accounts and other `super_admin` accounts; `admin` cannot manage staff.
4. **Staff creation is invite-only** — no public staff signup page, ever.
5. **Customer login is email + password** (Supabase Auth native, free). **Mobile number is a mandatory profile field**, collected at registration, used for contact/notifications only — NOT used for OTP/SMS login. Real mobile-OTP login needs a paid SMS provider (Twilio/MSG91/Firebase — none free at real scale); explicitly rejected for cost reasons.
6. **Email confirmation required** before a customer can log in after registering (avoids fake/typo emails).
7. New public env vars needed: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (same project as existing `SUPABASE_URL`, just anon-key/browser-safe versions).
8. **Local dev without Supabase configured cannot do auth at all** — accepted tradeoff. Auth-related dev requires the Supabase CLI local stack (`supabase start`). Plain-SQLite dev keeps working for non-auth work only, and will have **no staff login** once Task 13 (cleanup) lands.
9. Production Site URL / redirect URLs / custom SMTP (Resend) in Supabase Dashboard is manual, human-only config (Task 14) — flag as done only when a human confirms it, never claim it from code alone.

## Global constraints for every task

- Guest upload must keep working unmodified at every step until Task 11 explicitly wires it — and even after, `customer_user_id` stays nullable and anonymous uploads are a pure no-op change (unauthenticated `getUser()` returns `{user: null}`, no error).
- Use `@supabase/ssr` (NOT the deprecated `@supabase/auth-helpers-nextjs`).
- RLS enforces customer job-visibility and staff full access at the DB level — app code must not be the only gate.
- Reuse existing `.login-container`/`.login-card`/`.login-header`/`.login-logo`/`.login-form`/`.login-error`/`.login-btn`/`.login-footer` CSS classes (`globals.css` ~lines 2189-2460) for every new auth page (staff login, customer register/login/forgot/reset). Do not invent a parallel style system.
- `requireAdmin()`/`requireAdminResponse()` in `src/lib/security.ts` must keep their exact exported names/signatures so the 13 existing `src/app/api/admin/**` routes need zero changes.
- `verifyAgentToken` (agent token auth) and `SESSION_SECRET`'s use in `src/lib/storage.ts` (`signStoredName`/`verifyStoredNameSig`, upload-signing — unrelated to admin sessions) must NOT be touched or removed by this migration.

---

## Task 1: Install `@supabase/ssr` and add new Supabase env vars

**Files:** `package.json`, `.env.example`

**Steps:**
1. `npm install @supabase/ssr`.
2. In `.env.example`, add:
   ```
   # Required for Supabase Auth (staff + customer accounts).
   # Same Supabase project as SUPABASE_URL — these are the browser-safe versions.
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   ```
3. Comment that the anon key is safe to expose (RLS-protected); `SUPABASE_SERVICE_ROLE_KEY` must never be exposed this way.

**Verification:** `npm run typecheck` passes. `git diff package.json` shows only the new dependency.

---

## Task 2: Supabase server/browser/admin client helpers

**Files (new):** `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/admin.ts`

**Steps:**
1. `src/lib/supabase/client.ts` — browser client via `createBrowserClient` from `@supabase/ssr`, using `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. `src/lib/supabase/server.ts` — async `createClient()` using `createServerClient` from `@supabase/ssr`, wired to `next/headers` `cookies()` (`getAll`/`setAll`, wrapped in try/catch since Server Components can't set cookies — standard Next.js 15 `@supabase/ssr` recipe).
3. `src/lib/supabase/admin.ts` — service-role client using plain `@supabase/supabase-js` `createClient` with existing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Comment: "SERVER-ONLY — never import from a Client Component; bypasses RLS."
4. Do not touch `src/lib/db-supabase.ts` in this task.

**Verification:** `npm run typecheck`, `npm run build`.

---

## Task 3: `src/middleware.ts` for Supabase session refresh

**Files (new):** `src/middleware.ts`

**Steps:**
1. Standard Next.js 15 + `@supabase/ssr` middleware: bind `createServerClient` to the request/response cookies, call `await supabase.auth.getUser()` (not `getSession()`) to refresh the session cookie every request.
2. `matcher` excludes `_next/static`, `_next/image`, `favicon.ico`, and static image extensions.
3. No redirect/auth-gating logic here — cookie refresh only.

**Verification:** `npm run build` succeeds. `npm run dev`, load `/`, confirm no errors and guest upload flow still renders.

---

## Task 4: DB migration — `staff_profiles`, `customer_profiles`, `jobs.customer_user_id`, RLS

**Files (new):** `supabase/migrations/20260722000001_add_user_management.sql`

**Steps:**
1. Create `supabase/` directory with the migration (standard Supabase CLI convention: `supabase/migrations/<timestamp>_<description>.sql`).
2. SQL content:
   ```sql
   create table if not exists public.staff_profiles (
     id uuid primary key references auth.users(id) on delete cascade,
     email text not null,
     display_name text,
     role text not null check (role in ('super_admin', 'admin')),
     invited_by uuid references auth.users(id),
     created_at timestamptz not null default now()
   );

   create table if not exists public.customer_profiles (
     id uuid primary key references auth.users(id) on delete cascade,
     email text not null,
     display_name text,
     phone text not null,
     created_at timestamptz not null default now()
   );

   alter table public.jobs
     add column if not exists customer_user_id uuid references auth.users(id) on delete set null;

   create index if not exists jobs_customer_user_id_idx on public.jobs(customer_user_id);

   alter table public.jobs enable row level security;
   alter table public.staff_profiles enable row level security;
   alter table public.customer_profiles enable row level security;

   create or replace function public.is_staff()
   returns boolean
   language sql security definer stable
   as $$
     select exists (select 1 from public.staff_profiles where id = auth.uid());
   $$;

   create or replace function public.is_super_admin()
   returns boolean
   language sql security definer stable
   as $$
     select exists (select 1 from public.staff_profiles where id = auth.uid() and role = 'super_admin');
   $$;

   create policy "staff can read all staff profiles" on public.staff_profiles
     for select using (public.is_staff());
   create policy "super admins can insert staff profiles" on public.staff_profiles
     for insert with check (public.is_super_admin());
   create policy "super admins can delete staff profiles" on public.staff_profiles
     for delete using (public.is_super_admin());

   create policy "customers can read own profile" on public.customer_profiles
     for select using (auth.uid() = id);
   create policy "customers can update own profile" on public.customer_profiles
     for update using (auth.uid() = id);
   create policy "customers can insert own profile" on public.customer_profiles
     for insert with check (auth.uid() = id);

   create policy "customers can view own jobs" on public.jobs
     for select using (auth.uid() = customer_user_id);
   create policy "staff can view all jobs" on public.jobs
     for select using (public.is_staff());
   create policy "staff can update all jobs" on public.jobs
     for update using (public.is_staff());
   ```
   Note: `customer_profiles.phone` is `not null` per locked decision 5 (mandatory mobile field).
3. `customer_profiles`/`staff_profiles` rows are populated by application code at signup/invite time (Tasks 8/9), not DB triggers — keeps logic visible in TypeScript.
4. Apply via `mcp__supabase__apply_migration` against the real project, or `supabase db push` for local CLI stack.

**Verification:** `mcp__supabase__list_tables` confirms `staff_profiles`, `customer_profiles` exist and `jobs.customer_user_id` is present/nullable. `mcp__supabase__get_advisors` shows no new RLS warnings on these tables.

---

## Task 5: Add `StaffProfile`/`CustomerProfile` types

**Files:** `src/lib/types.ts`

**Steps:**
1. Add:
   ```ts
   export type StaffRole = "super_admin" | "admin";

   export type StaffProfile = {
     id: string;
     email: string;
     displayName: string | null;
     role: StaffRole;
     invitedBy: string | null;
     createdAt: string;
   };

   export type CustomerProfile = {
     id: string;
     email: string;
     displayName: string | null;
     phone: string;
     createdAt: string;
   };
   ```
2. Add `customerUserId: string | null` to the existing `Job` type.

**Verification:** `npm run typecheck`.

---

## Task 6: Rewrite `requireAdmin()`/`requireAdminResponse()` in `security.ts`

**Files:** `src/lib/security.ts`

**Steps:**
1. Replace PBKDF2/HMAC logic with a Supabase-session + `staff_profiles` check, preserving exact exported signatures:
   ```ts
   import { createClient } from "@/lib/supabase/server";
   import type { StaffProfile } from "./types";

   export async function requireAdmin(): Promise<StaffProfile | null> {
     const supabase = await createClient();
     const { data: { user }, error } = await supabase.auth.getUser();
     if (error || !user) return null;

     const { data: profile } = await supabase
       .from("staff_profiles")
       .select("id, email, display_name, role, invited_by, created_at")
       .eq("id", user.id)
       .single();

     if (!profile) return null;

     return {
       id: profile.id,
       email: profile.email,
       displayName: profile.display_name,
       role: profile.role,
       invitedBy: profile.invited_by,
       createdAt: profile.created_at,
     };
   }

   export async function requireAdminResponse() {
     const admin = await requireAdmin();
     if (!admin) {
       return NextResponse.json({ error: "Admin login required" }, { status: 401 });
     }
     return null;
   }
   ```
2. Since this is a hard cutover (locked decision 1): remove `hashSecret`, `verifySecret`, `makeSession`, the HMAC `sign()` helper, and `SESSION_MAX_AGE_MS`/`ITERATIONS`/`DIGEST` constants **only if** their only remaining caller (`seedDefaults`/`getAdminUser` in `db.ts`) is removed in the same pass — otherwise leave with a `// TODO(Task 13): remove` comment until Task 13 cleans up `db.ts`. Prefer: leave in place, remove in Task 13, to keep this task's diff focused on the auth-check logic only.
3. Remove the now-unused `getAdminUser` import from `./db`.
4. Keep `verifyAgentToken` untouched.

**Verification:** `npm run typecheck && npm run build`. Spot check 2-3 of the 13 admin routes (`src/app/api/admin/jobs/route.ts`, `src/app/api/admin/pricing/route.ts`) still typecheck with zero edits. Manual (needs Task 4 migration + a real staff row): logged-in staff hits any admin route → 200; logged out → 401 `{error: "Admin login required"}`.

---

## Task 7: Staff login/logout pages + routes (replace old admin login)

**Files:** `src/app/login/page.tsx` (new), `src/app/api/admin/login/route.ts` (rewrite), `src/app/api/admin/logout/route.ts` (rewrite), `src/app/api/admin/me/route.ts` (new), `src/components/AdminDashboard.tsx` (edit)

**Steps:**
1. `src/app/api/admin/login/route.ts`: `POST { email, password }` → `supabase.auth.signInWithPassword`. On success, verify a `staff_profiles` row exists for that user; if not, `signOut()` and return 403 "This account is not a staff account". On auth failure, 401 "Invalid email or password".
2. `src/app/api/admin/logout/route.ts`: call `(await createClient()).auth.signOut()`.
3. `src/app/api/admin/me/route.ts`: `GET` returns `requireAdmin()` result as JSON or 401 — used by dashboard shell and Task 8's invite UI to check `role === "super_admin"`.
4. `src/app/login/page.tsx`: Client Component, reuse existing `.admin-login-shell`/`.login-*` classes verbatim (copy structure currently inside `AdminDashboard.tsx`'s inline `AdminLogin` component), change `username` field to `email` (type="email"), POST to `/api/admin/login`, redirect to the admin dashboard route on success.
5. `AdminDashboard.tsx`: delete the inline `AdminLogin` component and its `login()` handler and the `admin-login-shell` render branch. Replace with: on mount, `GET /api/admin/me`; if 401, `router.push("/login")`.

**Verification:** `npm run build`. Manual: seed the super-admin (`pdebashish608@gmail.com`, locked decision 2) in Supabase Auth + a matching `staff_profiles` row, log in via `/login`, reach dashboard. Manual: `curl -X POST /api/admin/login -d '{"username":"admin","password":"1234"}'` → confirm 401 (old bypass gone — this only fully applies after Task 13, but should already fail here since `admin_users` lookup/body-shape no longer matches).

---

## Task 8: Staff (super-admin/admin) management — invite + list + revoke

**Files (new):** `src/app/api/admin/staff/route.ts`, `src/app/api/admin/staff/[id]/route.ts`, `src/components/StaffManagement.tsx`

**Steps:**
1. `src/app/api/admin/staff/route.ts`:
   - `GET`: `requireAdminResponse()` guard, any staff can list (`select * from staff_profiles order by created_at`).
   - `POST` (invite): `requireAdmin()` guard, 403 if `admin.role !== "super_admin"`. Body `{ email, role }` (`role` in `"super_admin"|"admin"`). Use the service-role admin client (Task 2) → `supabase.auth.admin.inviteUserByEmail(email, { redirectTo: <site-url>/staff/accept-invite })`. On success, insert `staff_profiles` row `{ id: invited user id, email, role, invited_by: admin.id }`.
2. `src/app/api/admin/staff/[id]/route.ts`: `DELETE` — super-admin only (403 otherwise), `supabase.auth.admin.deleteUser(id)` (cascades to `staff_profiles`).
3. `src/components/StaffManagement.tsx`: form (email + role select) + table of staff with "Revoke" button, gated on `role === "super_admin"` (from `/api/admin/me`) — hidden entirely for `admin` role. Wire into `AdminDashboard.tsx` following the existing tab-registration pattern (mirror how `AccountsTab.tsx` is wired in).

**Verification:** `npm run build`. Manual: as super-admin, invite a test email → row appears in `staff_profiles`, Supabase Dashboard shows invited user. Log in as `admin` role → Staff Management tab hidden; direct `POST` to the invite route as `admin` → 403.

---

## Task 9: Customer register/login/forgot-password/reset-password

**Files (new):** `src/app/register/page.tsx`, `src/app/login/page.tsx`, `src/app/forgot-password/page.tsx`, `src/app/reset-password/page.tsx`, `src/app/api/user/register/route.ts`, `src/app/api/user/login/route.ts`, `src/app/api/user/logout/route.ts`, `src/app/api/user/forgot-password/route.ts`

**Steps:**
1. All pages: Client Components reusing `.login-container`/`.login-card`/`.login-form`/`.login-error`/`.login-btn`/`.login-footer` classes (same system as staff login).
2. `src/app/api/user/register/route.ts`: `POST { email, password, displayName, phone }` — **`phone` is required** (locked decision 5); validate non-empty (basic format check, no SMS verification). `supabase.auth.signUp({ email, password })` via `src/lib/supabase/server.ts`'s anon client. Insert `customer_profiles` row `{ id: data.user.id, email, display_name: displayName, phone }`. Return `{ ok: true, needsEmailConfirmation: !data.session }` (locked decision 6: email confirmation required, so this will normally be true).
3. `src/app/api/user/login/route.ts`: `POST { email, password }` → `signInWithPassword`. Verify a `customer_profiles` row exists; if not, clear error (e.g. staff account on wrong page) rather than silently allowing cross-use.
4. `src/app/api/user/logout/route.ts`: `auth.signOut()`.
5. `src/app/api/user/forgot-password/route.ts`: `POST { email }` → `resetPasswordForEmail(email, { redirectTo: <site-url>/reset-password })`. Always return `{ ok: true }` regardless of whether the email exists (no user enumeration).
6. `src/app/reset-password/page.tsx`: reads Supabase recovery session from the redirect, form for new password, `supabase.auth.updateUser({ password })` directly from the browser client.
7. Add minimal nav links between register/customer-login/forgot-password and back to `/`, plus an optional "Have an account? Log in" link from the home page header — must not obscure or complicate the guest upload path.

**Verification:** `npm run build`. Manual: register test customer (with phone), confirm `customer_profiles` row created with phone set, confirm email requirement blocks login until confirmed, log in, forgot-password round-trip (check Supabase Auth Logs in dev if SMTP not yet configured).

---

## Task 10: Customer dashboard (job history)

**Files (new):** `src/app/my-jobs/page.tsx`, `src/app/api/user/jobs/route.ts`

**Steps:**
1. `src/app/api/user/jobs/route.ts`: `GET` — use the anon-key cookie-bound client (`src/lib/supabase/server.ts`, NOT `db-supabase.ts`'s service-role client) so RLS (Task 4) does the filtering. 401 if `getUser()` returns null. Add explicit `.eq("customer_user_id", user.id)` too, as defense-in-depth.
2. `src/app/my-jobs/page.tsx`: lists the customer's jobs (status/date/price), linking to the existing job-tracking page/component for details — reuse whatever summary card component already exists for the customer token screen rather than duplicating markup.
3. Add a "My Jobs" link (server-side session check) vs. "Log in" link in the home page header depending on customer session state.

**Verification:** `npm run build`. Manual: two customer accounts, Customer A uploads while logged in (after Task 11), confirm Customer B's `/api/user/jobs` never returns Customer A's job (RLS-enforced — test via curl with Customer B's session cookie, not just UI).

---

## Task 11: Wire `UploadForm.tsx`/`api/jobs/route.ts` to stamp `customer_user_id`

**Files:** `src/app/api/jobs/route.ts`, `src/lib/db.ts`, `src/lib/db-supabase.ts`

**Steps:**
1. In `src/app/api/jobs/route.ts` (`POST` handler, both single-file and `handleBulk` paths), add:
   ```ts
   const supabase = await createClient();
   const { data: { user } } = await supabase.auth.getUser();
   const customerUserId = user?.id ?? null;
   ```
   Thread `customer_user_id: customerUserId` into the existing `jobData` object before `createJob`/`createJobWithFiles`. Guest flow is unaffected — unauthenticated `getUser()` returns `{user: null}` with no error.
2. `src/lib/db.ts`: add `customer_user_id` column to SQLite `jobs` CREATE TABLE (schema parity, unused without auth in pure-SQLite mode) and persist it in `createJobWithFiles`. `src/lib/db-supabase.ts`: persist `customer_user_id` in its insert.
3. No client-side change needed in `UploadForm.tsx` — the field is derived server-side from the session cookie, not from form data (can't be spoofed).

**Verification:** `npm run test` — existing tests covering `api/jobs/route.ts` must pass unmodified (guest behavior untouched). Manual: guest upload (no cookies) → job created with `customer_user_id = null`, response shape unchanged. Logged-in customer upload → job appears in Task 10's `/my-jobs`.

---

## Task 12: Local dev story — Supabase CLI local stack

**Files (new):** `supabase/config.toml` (via `supabase init`), `docs/LOCAL_DEV_AUTH.md`

**Steps:**
1. `supabase init` at repo root.
2. Document in `docs/LOCAL_DEV_AUTH.md`: install Supabase CLI → `supabase start` (local Postgres + Auth + Studio + Inbucket) → copy printed keys into `.env.local` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) → `supabase db push` to apply Task 4's migration → manually create a local super-admin user via Studio + matching `staff_profiles` row.
3. State explicitly: reset/invite emails in local dev land in Inbucket (`http://127.0.0.1:54324`), no SMTP needed locally. Non-auth contributors keep using plain SQLite (leave `SUPABASE_URL` unset); anyone touching login/register/staff/customer code must run the local stack.
4. Update `CLAUDE.md`'s environment section to link to this doc.

**Verification:** Manual walkthrough on a clean checkout confirms login succeeds end to end. Cannot be automated — state that rather than fabricating a test.

---

## Task 13: Cleanup — remove `admin_users`, old security.ts code, default credentials, update docs

**Files:** `src/lib/security.ts`, `src/lib/config.ts`, `src/lib/db.ts`, `src/lib/db-supabase.ts`, `CLAUDE.md`, `.env.example`, new `supabase/migrations/<timestamp>_drop_admin_users.sql`

**Steps:**
1. `security.ts`: remove `hashSecret`, `verifySecret`, `makeSession`, HMAC `sign()`, unused constants. Keep `requireAdmin`/`requireAdminResponse` (Task 6) and `verifyAgentToken`.
2. `config.ts`: remove `SESSION_COOKIE`, `DEFAULT_ADMIN_USERNAME`, `DEFAULT_ADMIN_PASSWORD`. **Do not remove `SESSION_SECRET`** — `src/lib/storage.ts` still uses it for upload-signing (`signStoredName`/`verifyStoredNameSig`), unrelated to admin sessions. Grep first: `grep -rn "SESSION_SECRET" src`.
3. `db.ts`: remove `admin_users` from `initSchema`, remove `getAdminUser`, remove its seed row from `seedDefaults` (keep `seedDefaults` if it still seeds `agent_tokens`).
4. `db-supabase.ts`: remove its `getAdminUser`.
5. New migration: `drop table if exists public.admin_users;`.
6. `CLAUDE.md`: replace "No customer authentication required" line with accurate description (optional customer accounts + guest flow preserved); remove `admin_users` from the SQLite table list, add `staff_profiles`/`customer_profiles`; remove the default-credentials (`admin`/`1234`) section; link to `docs/LOCAL_DEV_AUTH.md`.
7. `.env.example`: remove `ADMIN_USERNAME`/`ADMIN_PASSWORD` if present.

**Verification:** `grep -rn "admin_users\|DEFAULT_ADMIN\|hashSecret\|verifySecret\|makeSession" src` → no results. `npm run typecheck && npm run build && npm run test` all pass. `curl -X POST /api/admin/login -d '{"username":"admin","password":"1234"}'` → 401 (old defaults fully gone).

---

## Task 14: Manual SMTP/email provider setup (Resend) — human-only, dashboard config

**Files:** none (optionally `docs/EMAIL_SETUP.md`, no secrets in it)

**Steps (human, not automatable):**
1. Resend account + verified sending domain (SPF/DKIM at registrar).
2. Resend API key.
3. Supabase Dashboard → Project Settings → Auth → SMTP Settings → enable custom SMTP with Resend credentials (`smtp.resend.com`, port 465/587, user `resend`, password = API key).
4. Supabase Dashboard → Authentication → URL Configuration → set Site URL to production domain, add redirect URLs for `/reset-password`, `/staff/accept-invite`, and any staging domains.
5. Optionally customize invite/reset/confirm email templates.
6. Send real test invite (Task 8) and real test password reset (Task 9) in production, confirm delivery from the shop's own domain.
7. Document what was configured (not the API key) in `docs/EMAIL_SETUP.md`.

**Verification:** Cannot be automated — requires a human checking a real inbox. State explicitly rather than claiming pass/fail from code.

---

## Execution order

Tasks 1→4 are foundational (no user-facing behavior yet, safe to do in sequence). Tasks 5-6 touch shared types/auth-check. Tasks 7-8 (staff) and 9-10 (customer) are independent of each other but both depend on 1-6. Task 11 depends on 9 (needs `createClient` pattern proven) conceptually but is technically independent — order after 9 for a working end-to-end demo. Task 12 (local dev docs) can happen any time after Task 4. Task 13 (cleanup) must be last — it deletes code Tasks 6/7 still reference until then. Task 14 is manual and can happen in parallel with anything from Task 8 onward (needed for real invite/reset emails to deliver, but doesn't block code tasks).

## Critical files
- `src/lib/security.ts`
- `src/lib/db.ts`
- `src/lib/db-supabase.ts`
- `src/app/api/jobs/route.ts`
- `src/components/AdminDashboard.tsx`
