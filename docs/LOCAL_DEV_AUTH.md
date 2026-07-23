# Local Dev: Supabase Auth (Local Stack)

Self_Print's staff and user login runs on Supabase Auth (migrated off the old
hardcoded admin login). Most local development does **not** need this — only work that
touches login, register, staff management, or customer accounts does.

## Do you need this?

- **Not touching login/register/staff/customer code?** Skip this doc. Leave `SUPABASE_URL`
  and `SUPABASE_SERVICE_ROLE_KEY` unset in `.env` and the app falls back to plain SQLite
  (`src/lib/db.ts`), same as before user management existed. Print queue, admin job
  dashboard (non-auth parts), pricing, and the print agent all work fine this way.
- **Touching login, register, staff management, or customer account code?** You must run
  the Supabase CLI local stack described below. There is no way to exercise real Supabase
  Auth flows (sign-in, password reset, invites, RLS policies) against plain SQLite.

## Setup

### 1. Install the Supabase CLI

Follow the official install instructions for your platform:
https://supabase.com/docs/guides/local-development/cli/getting-started

Verify with:

```powershell
supabase --version
```

### 2. Initialize the project (one-time)

From the repo root:

```powershell
supabase init
```

This generates `supabase/config.toml`. It will not touch the existing
`supabase/migrations/` directory — `init` only adds local CLI config, it does not
regenerate or overwrite migrations.

### 3. Start the local stack

```powershell
supabase start
```

This spins up local Postgres, Auth, Studio, and Inbucket (a fake mail server) in Docker.
On first run it prints connection info including a local API URL, anon key, and service
role key — keep that output visible, you'll need it next.

### 4. Configure `.env.local`

Copy the printed local values into `.env.local` (create it if it doesn't exist; it's
gitignored):

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<service_role key printed by `supabase start`>
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key printed by `supabase start`>
```

Setting `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` is what switches the app from SQLite
to Supabase (see "Dual database" in `CLAUDE.md`).

### 5. Apply migrations

```powershell
supabase db push
```

This applies `supabase/migrations/20260722000001_add_user_management.sql` (and any other
pending migrations) to your local Postgres instance — creating `staff_profiles`,
`customer_profiles`, `jobs.customer_user_id`, and the associated RLS policies.

### 6. Create a local super-admin user

There's no seed script for this (by design — see the migration's comment: profile rows
are created by application code at signup/invite time, not by DB triggers). To get a
working admin login locally:

1. Open Supabase Studio at `http://127.0.0.1:54323`.
2. Go to **Authentication → Users** and create a user (email + password) — Studio can
   auto-confirm the email for you locally, no verification email needed.
3. Go to **Table Editor → staff_profiles** and insert a row for that user:
   - `id` = the auth user's UUID (copy from the Authentication page)
   - `email` = same email
   - `role` = `super_admin`
4. Sign in to `/admin` locally with that email/password.

## Emails in local dev

Local password reset and invite emails do **not** go anywhere real — the local stack has
no SMTP configured. They land in **Inbucket** at `http://127.0.0.1:54324`, a local mail
catcher bundled with `supabase start`. Open it to view/click links sent during local
testing (password resets, staff invites, etc.). You never need to configure SMTP for
local development.

## Stopping the stack

```powershell
supabase stop
```

Data persists across `start`/`stop` (it's a Docker volume) unless you pass `--no-backup`
or run `supabase db reset`.

## Summary

| Scenario | What to run |
|---|---|
| Non-auth work (print queue, pricing, print agent, etc.) | Nothing — plain SQLite, no `SUPABASE_URL` set |
| Login / register / staff / customer account work | `supabase start` + steps above, every session |

## Verification note

There is no automated test for this setup — it's inherently a local infrastructure/manual
flow (Docker containers, CLI install, interactive Studio steps). Verification is a manual
walkthrough on a clean checkout: install the CLI, run through steps 1-6 above, and confirm
you can log in to `/admin` with the created super-admin user. That walkthrough has not been
run as part of this change (the Supabase CLI is not installed on this machine); this doc
should be validated by whoever next does auth-related work locally.
