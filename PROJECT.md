# SelfPrint — Project Overview

QR-friendly print queue system for Xerox/print shops. Customer scan QR, upload file (mobile data), pick print settings, get token, pay, staff release from admin dashboard, Windows agent prints via GDI (PowerShell).

## Stack

- Next.js 15 (App Router), React 19, TypeScript
- DB: `better-sqlite3` (local dev) OR Supabase Postgres (prod) — auto-switch by env
- Auth: Supabase Auth (`@supabase/supabase-js`, `@supabase/ssr`) — staff + customer accounts
- Storage: local filesystem (dev) or Supabase Storage private bucket `selfprint` (prod)
- PDF: `pdfjs-dist` (client page count), `@hyzyla/pdfium` (server/agent PDF→PNG), `sharp`
- Payments: Razorpay + UPI QR (`qrcode.react`)
- Print agent: standalone Node/TSX script on shop PC, Windows GDI print via PowerShell
- Tests: vitest

## Commands

```bash
npm run dev        # dev server
npm run build       # prod build
npm run typecheck
npm run db:seed     # init/seed SQLite
npm run cleanup     # purge printed/cancelled/expired uploads
npm run agent       # run Windows print agent
npm run convert     # DOCX->PDF conversion CLI
npm test            # vitest
npm run package:shop            # bundle shop-PC agent zip
npm run package:shop -- --publish  # + publish self-update payload to Storage
npm run agent:push-update       # queue that update for the shop PC (CLI twin of the admin button)
```

## Architecture

```
Customer browser ──▶ Next.js app (src/app) ──▶ src/lib/db.ts (smart router)
                                                       │
                                  ┌────────────────────┴────────────────────┐
                                  ▼                                         ▼
                       SQLite (dev, data/selfprint.sqlite)         Supabase Postgres (prod)
                                  │                                         │
                                  ▼                                         ▼
                       local filesystem (uploads/)              Supabase Storage bucket "selfprint"
                                                                            ▲
                                                                     Realtime + polling
                                                                            │
                                                                 agent/src/index.ts (shop PC)
                                                                            │
                                                                            ▼
                                                                 Windows printer (GDI/PowerShell)
```

`src/lib/db.ts` checks `isSupabase = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)`; if false, runs SQLite inline, else lazily delegates to `src/lib/db-supabase.ts`. Whole app runs on pure local SQLite w/ zero Supabase config in dev.

Admin dashboard live-updates via SSE (`sseClients`/`broadcastSse` in db.ts) + Supabase Realtime (used by print agent).

## Database schema

### `jobs` (core)
id, token (6-digit customer code), status (`pending_payment`/`paid`/`approved`/`printing`/`printed`/`failed`/`cancelled`), print_type (`bw`/`color`), copies, page_range, paper_size (A3/A4/A5/A6/B5/Letter/Legal/Photo), layout (portrait/landscape), pages_per_sheet (1-4 N-up), margins, scale, duplex (simplex/long-edge/short-edge), page_count, price_paise, needs_conversion, queue_position (daily-reset), created_at/updated_at, paid_at, paid_via (online/counter), printed_at, issue_reported_at/issue_note/issue_resolved_at, delivery_method (pickup/delivery), customer_name/phone/delivery_address, delivery_fee_paise, delivery_status (pending/out_for_delivery/delivered), delivery_latitude/longitude/accuracy/captured_at (GPS), customer_user_id (FK auth.users, null for guests), delivery_person_id (rider, Supabase only).

Indexes: status, created_at, queue_position, (status, needs_conversion, updated_at) for agent polling, (delivery_method, delivery_status, created_at) for dispatch.

### `job_files`
id, job_id (FK cascade), original_name, stored_name, mime_type, size_bytes, file_kind (pdf/image/document), storage_path, created_at, purged_at (set when bytes purged for privacy, row kept for history).

### `pricing_config` (singleton id=1)
bw_per_page_paise, color_per_page_paise, photo_print_paise, copy_multiplier, a3/a4/a5/a6/b5/legal/photo_multiplier, duplex_bw_per_page_paise, expiry_minutes (default 1440), delivery_fee_paise, updated_at.

### `agent_config` (singleton id=1)
printer_name (legacy single-printer field, kept as fallback), bw_printer_name, color_printer_name (independent B/W vs. color printer selection — the agent picks per job's print_type, falling back to printer_name if the specific one is unset), config_version (bumped so agents detect changes), updated_at, plus self-update state: agent_version (version the agent reports running), agent_healthy_at (last health heartbeat), update_target_version, update_status (`requested`/`downloading`/`swapping`/`success`/`failed`/`rolled_back`), update_message, update_started_at.

### `agent_update_events`
Append-only audit of update attempts: id, from_version, to_version, status (`success`/`failed`/`rolled_back`), message, created_at. Written by the agent (service-role); staff read-only via RLS. Migration: `supabase/migrations/20260806000000_agent_self_update.sql`, with SQLite parity in `src/lib/db.ts`.

### `agent_printers`
name (PK), driver_name, port_name, is_default, seen_at (heartbeat; stale >5min = offline).

### `agent_tokens`
id, name, token_hash (hashed via token-hash.ts) — legacy of the removed HTTP agent API; still seeded but no longer consulted (the agent uses the Supabase service-role key).

### `print_events`
Append-only audit log: id, job_id (FK cascade), event_type (created/paid/printing/printed/converted/customer_report/issue_resolved/reprint/out_for_delivery/delivered/...), message, created_at. Drives admin job timeline + agent progress reporting.

### Supabase-only tables
- `staff_profiles`: id (FK auth.users), email, display_name, role (super_admin/admin/delivery), invited_by, created_at. RLS: staff read all, only super_admin inserts/deletes.
- `customer_profiles`: id (FK auth.users), email, display_name, phone, avatar_url, created_at. RLS: own row only.
- `admin_login_events`: staff_id, email, ip, user_agent, browser, os, device, city, country, success, failure_reason, logged_at — staff login audit.
- RLS: customers see own jobs (`customer_user_id = auth.uid()`); staff (`is_staff()`) see/update all; delivery-role sees delivery-method jobs only.
- Security-definer RPCs `claim_delivery_job(job_id)` / `complete_delivery_job(job_id)` — column-restricted, race-safe atomic claim, admin override.

## Env vars

| Var | Purpose |
|---|---|
| `AGENT_TOKEN` | dev fallback secret for `/api/cleanup` (prod uses `CRON_SECRET`); seeded into `agent_tokens` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | server-side Supabase (DB+Storage). Empty → falls back to SQLite/filesystem |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser Supabase (RLS) for Auth |
| `NEXT_PUBLIC_SITE_URL` | base URL for auth emails |
| `SHOP_UPI_ID`, `SHOP_NAME` | personal UPI QR payment |
| `SHOP_UPI_QR` | raw merchant UPI QR string (priority over SHOP_UPI_ID) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay checkout + webhook |
| `CRON_SECRET` | protects `/api/cleanup` |
| `DATABASE_PATH`, `UPLOAD_DIR`, `MAX_UPLOAD_MB` (25), `SESSION_SECRET` (HMAC signing), `FILE_RETENTION_DAYS` (3), `VERCEL` (auto redirects SQLite/uploads to /tmp/selfprint) | config.ts extras |

Agent config: `agent/config.json` (copy `agent/dev-tools/config.example.json`) — supabaseUrl, supabaseKey, tempDir, maxRetries, fallbackPrinter (or falls back to SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env; fallbackPrinter is only a startup default, overridden by `agent_config.bw_printer_name`/`color_printer_name` once set from `/admin`); `updateMode` — only `"manual"` is implemented, anything else is refused at startup.

Agent self-update: `agent/version.json` is the installed version. `npm run package:shop -- --publish` uploads `agent-<version>.zip` then `latest.json` (last, so a partial publish never advertises a payload; an orphaned zip is rolled back on failure) into the private `agent-updates` Storage bucket — refusing to republish an existing version or to go backwards. `kind` is `code` (just `agent/`) unless a runtime dep moved, then `full`. Installs are triggered from the "Print agent" card in `/admin`'s Printer panel (`src/app/api/admin/agent-update/route.ts`, super_admin only) or `npm run agent:push-update` — both just write `agent_config` and bump config_version; there is no direct channel to the shop PC. `agent/src/updater.ts` verifies sha256, stages into `<root>/update-staging/payload`, renders `agent/updater-template.bat` and runs it as its own one-shot `SelfPrintUpdater` scheduled task (a child would be killed with the agent's job object), then exits. The bat swaps, restarts `SelfPrintAgent`, and waits 90s for `agent-health.txt` to contain the target version; no heartbeat → restore the backup, write `update-rollback.txt`, restart. Markers `update-pending.txt`/`update-rollback.txt` are read on next startup to report `success`/`failed`/`rolled_back`; trace lives in `update-staging/updater.log`. Updates defer while a job is printing.

`agent/` layout: only `SETUP.bat` (client-facing entry point) and `TEST-PRINTER.bat` (optional troubleshooting) are meant to be run directly. `config.json`, `print-image.ps1`, `START-PRINTER.bat`, `START-PRINTER-BACKGROUND.vbs`, and `src/` are internal machinery with hardcoded relative paths to each other/the repo root — don't move them. `agent/dev-tools/` holds developer-only scripts (`INSTALL-AUTOSTART.bat`/`start-agent.bat` — superseded by `SETUP.bat`; `STOP-DEV-AGENT.bat` — kills a stray agent process on a dev machine; `config.example.json` — the config template) that a shop-PC client never needs to see or run.

Shop-PC delivery: `agent/SETUP.bat` is the one-click entry point (Node/config checks + Scheduled Task registration + immediate run, consolidating what `START-PRINTER.bat`/`agent/dev-tools/INSTALL-AUTOSTART.bat` did as two separate steps — both still exist individually for troubleshooting). `scripts/package-for-shop.mjs` bundles `package.json` + `node_modules` + `agent/` (including the real, gitignored `config.json`) into `dist-shop-package/selfprint-agent.zip` so a non-technical client only unzips and double-clicks `SETUP.bat` — no `git clone`, no editing files, no `npm install` on-site. Full walkthrough (including a fully-local/no-Supabase alternative): `docs/CLIENT_PC_SETUP.md`.

No hardcoded credentials: staff login is Supabase Auth (invite-only via `staff_profiles`); the agent uses the service-role key from `agent/config.json`.

Production hardening: config.ts logs console error at boot if NODE_ENV=production and SESSION_SECRET/AGENT_TOKEN unset/default.

## File storage

- Local: `<repo>/uploads` (or `/tmp/selfprint/uploads` on Vercel) → `originals/`, `converted/`.
- Supabase: private bucket `selfprint`, same two folders, path via `bucketPathFor(kind, storedName)`.
- Stored names always `<uuid>.<ext>`, validated against path traversal (`STORED_NAME_RE`).
- Upload paths: server multipart, OR direct-to-Supabase-Storage via signed URL (`/api/uploads/sign` → `createSignedUpload`), then client calls `/api/jobs` with `storedName` + HMAC sig (`signStoredName`/`verifyStoredNameSig`, keyed by SESSION_SECRET) — anti-IDOR, binds sign step to job creation.
- Downloads: short-lived (10min) signed URLs or streamed reads (manual-print proxy).
- Privacy retention: `cleanupOldJobs()` purges file *bytes* (not row) FILE_RETENTION_DAYS (3) after job reaches printed/cancelled/failed, except undelivered delivery orders. Abandoned unpaid carts past pricing expiry window deleted entirely (row+files).

## Pricing logic (`src/lib/pricing.ts`)

`calculatePrice({printType, copies, pageRange, paperSize, pageCount, pricing, duplex, pagesPerSheet})`:
1. Resolve effective page count from pageRange ("all"/empty → full doc, even/odd → half floor/ceil, explicit ranges "1-3,5" → parsed Set).
2. Photo paper: flat `photoPrintPaise * copies`, bypasses other multipliers (pagesPerSheet not applicable).
3. N-up: `sides = ceil(selectedPages / pagesPerSheet)` — bills by physical printed sides actually consumed, not raw document page count (a 4-up 8-page doc uses 2 sides).
4. Else: base per-side rate = bwPerPagePaise or colorPerPagePaise (simplex); duplex B/W uses duplexBwPerPagePaise for full double-sided pairs of sides (`floor(sides/2)*2`) + simplex rate for a trailing odd side; duplex color always uses simplex color rate.
5. Side cost × copies × paper-size multiplier (a3/a4/a5/a6/b5/legalMultiplier; Letter maps to A4 multiplier) × copyMultiplier, rounded.
6. Delivery jobs add flat deliveryFeePaise on top.

Admin-editable via `/api/admin/pricing`, cached in-memory (`pricingCache` in db.ts, invalidated on updatePricing).

## Customer flow

1. **Upload** (`/` → UploadForm.tsx → `POST /api/jobs`): choose settings, upload PDF/JPG/PNG (DOCX rejected client-side, told to convert first — validateUpload only allows application/pdf, image/jpeg, image/png). Delivery requires name + 10-digit phone + address, optional GPS; blocked for needsConversion jobs. Rate-limited 10 job creations/min/IP. Bulk multi-PDF upload supported (bulk=true, up to MAX_BULK_FILES, shared settings, no page range).
   - Direct-to-Supabase upload option via signed URL + HMAC.
   - Logged-in customers get customerUserId stamped (via customer_profiles lookup, staff sessions excluded); guests tracked by token only.
   - Job created `pending_payment`; price computed server-side (never trusts client price); daily-reset queue_position assigned.
2. **Payment**: Razorpay Checkout (`/api/payments/order` → client checkout → `/api/payments/verify` HMAC-validates, calls markJobPaid(id,"online"), idempotent) backed by `/api/payments/webhook` (payment.captured) for early-close recovery; OR UPI QR (SHOP_UPI_ID/SHOP_UPI_QR) pay-at-counter, staff marks paid (paid_via="counter").
3. **Tracking**: `/track` + `GET /api/jobs/[token]/status` polls status/queue position (getJobsAhead, daily-scoped)/ETA. Customer can `POST /api/jobs/[token]/report` to flag issue (reportJobIssue, idempotent). Receipt at `/api/jobs/[token]/receipt`.
4. **Registered customers**: `/register`, `/login`, `/account`, `/complete-profile` (phone capture), `/my-jobs` (history via `/api/user/jobs`), `/forgot-password`, `/reset-password`, email confirm resend. Auth via Supabase Auth, customer_profiles table, RLS scoped to auth.uid().
5. **Delivery**: after printed+paid, job eligible for delivery pool; delivery-role staff claims (`claim_delivery_job` RPC), later completes (`complete_delivery_job` RPC).

## Admin flow

Auth: Supabase Auth session + staff_profiles lookup (requireAdmin()/requireAdminResponse() in security.ts); roles super_admin/admin/delivery.

Pages (`src/app/admin/*`):
- `/admin` — dashboard/queue, live via SSE
- `/admin/jobs/[id]` — detail (settings edit, status change, print_events timeline, issue resolution, reprint)
- `/admin/jobs/[id]/print` — manual print view (streams file for browser print fallback)
- `/admin/orders`, `/admin/customers`, `/admin/accounts` (daily analytics), `/admin/staff` (super_admin only), `/admin/security` (login audit)

API (`src/app/api/admin/*`): jobs, jobs/[id], jobs/[id]/status, jobs/[id]/delivery-status, jobs/[id]/reprint, jobs/[id]/convert, jobs/[id]/resolve-issue, jobs/bulk-delete, pricing, printer/printers, summary, notifications, analytics/daily, customers, staff/staff/[id]/staff/create, login/logout/me/login-events.

## Print agent flow (`agent/src/index.ts`)

`npm run agent`, config from agent/config.json:
1. Subscribes Supabase Realtime on `jobs` (postgres_changes), triggers processJob when row → status='approved' && !needs_conversion.
2. Polling fallback every 5s (pollApprovedJobs) catches missed Realtime events; exponential-backoff reconnect on channel errors.
3. Reports installed printers (Get-Printer via PowerShell) to agent_printers every 60s; re-reads configured printer every 30s.
4. Multi-agent safety: checks configured printer installed locally before claiming; if not, leaves job approved for another agent. Claims atomically via conditional UPDATE...WHERE status='approved' (race-safe).
5. Downloads file(s) from Supabase Storage (handles object paths + legacy signed/public URLs), retries up to maxRetries, logs progress to print_events (downloaded, spooling).
6. Printing: images print directly; PDFs rasterized page-by-page to PNG via @hyzyla/pdfium (BGRA→RGBA fix, grayscale+lower DPI for B/W), then all images handed to `agent/print-image.ps1` via execFile("powershell.exe",...) — actual Windows GDI print (paper size, duplex, margins, scale, N-up, color, copies, collate). Chosen over SumatraPDF because Sumatra failed to spool reliably on shop's Epson driver.
7. Success → status='printed'; exhausted retries → status='failed' w/ error naming the broken file; stale printing jobs (agent crash mid-print) auto-reset to approved by cleanup cron (PRINTING_LEASE_MINUTES=10 in db.ts).
8. Crash-proofed via top-level uncaughtException/unhandledRejection handlers; graceful shutdown on SIGINT/SIGTERM finishes current job first.

The agent talks to Supabase directly (service-role key); there is no HTTP agent API. (The old `/api/agent/*` routes were removed as dead code — the agent never called them.)

## Cron/maintenance

- `/api/cleanup` (CRON_SECRET-protected) → cleanupOldJobs(): resets stale printing leases, deletes abandoned unpaid carts, purges old finished-job file bytes.
- `scripts/seed.ts`, `scripts/cleanup.ts`, `scripts/convert.ts` — CLI equivalents (tsx --env-file-if-exists=.env).
- `src/lib/convert.ts` — server-side DOCX→PDF conversion (needs_conversion=1 jobs), triggered manually via `/api/admin/jobs/[id]/convert` or convert script.

## Key design decisions

- Manual counter payment: job must be "paid" before release.
- DOC/DOCX stored but marked needsConversion, can't release until converted.
- No customer auth required (guest flow supported alongside registered accounts).
- Agent API: bearer token auth. Admin: Supabase Auth session.
- Dual DB backend (SQLite dev / Supabase prod) via single smart-router module — no separate codepaths in feature code.
- Agent updates are pushed through the database, not to the agent: the shop PC sits behind NAT, so `agent_config` is the only channel, and every failure path leaves a working agent installed (health-gated rollback).
