# Self_Print

A QR-friendly self-service print queue for Xerox shops. Customers scan a QR code, upload files using their own mobile data, select print settings, receive a token, pay at the counter, and staff release the job from the admin dashboard. A Windows agent on the shop PC polls approved jobs and sends them to the selected printer.

## Quick Start

### 1. Start the web app

```powershell
npm install
npm run db:seed
npm run dev
```

Customer URL: `http://localhost:3000/`
Admin URL: `http://localhost:3000/admin`

### 2. Start the print agent (on shop PC)

```powershell
npm run agent
```

For shop use, prefer the Electron installer in `electron-agent/build-output`. It includes the portable print engine, so the shop owner does not need to install a PDF reader separately.

---

## Setup

### Environment

Create a `.env` file:

**SQLite mode (default, local):**
```env
AGENT_TOKEN=dev-agent
```

**Supabase mode (cloud/production):**
```env
AGENT_TOKEN=dev-agent
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Supabase mode activates automatically when both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set; otherwise the app falls back to local SQLite. There is no separate toggle flag.

> **Security:** `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and has full DB access. Use it server-side only — never expose it to the browser or commit it. The print agent (`agent/config.json`) also uses a service-role key; keep that file out of version control.

Everything else uses safe defaults. Admin login: `admin` / `1234`

### Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Create the 8 tables matching the SQLite schema in `src/lib/db.ts` (`jobs`, `job_files`, `pricing_config`, `agent_config`, `agent_printers`, `admin_users`, `agent_tokens`, `print_events`)
3. Seed the config rows (pricing, agent config, admin user, agent token). The admin password and agent token are stored as PBKDF2 hashes — see `hashSecret` in `src/lib/security.ts`.
4. **Enable RLS** on all 8 tables. The web app and print agent both connect with the service-role key, which bypasses RLS, so a deny-all (RLS on, no policies) state is safe and blocks all anon-key access:

```sql
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_events ENABLE ROW LEVEL SECURITY;
```

5. Add covering indexes for the foreign keys and agent-poll query (performance). `jobs.token` is already indexed by its `UNIQUE` constraint:

```sql
CREATE INDEX idx_job_files_job_id ON public.job_files(job_id);
CREATE INDEX idx_print_events_job_id ON public.print_events(job_id);
CREATE INDEX idx_jobs_approved ON public.jobs(status, needs_conversion, updated_at);
```

### Print Agent

1. Build or open the installer from `electron-agent/build-output`.
2. Install/run `SelfPrint Agent`.
3. Enter the server URL and agent token once.
4. Select the printer from the admin dashboard.

The Electron agent bundles portable SumatraPDF as the print engine. This keeps setup simple for the shop owner while still allowing silent printing with page range, copies, paper size, orientation, color mode, and scale where the printer driver supports them.

For developer CLI testing, copy `agent/config.example.json` to `agent/config.json` and edit:

```json
{
  "serverUrl": "http://localhost:3000",
  "agentToken": "dev-agent",
  "sumatraPath": "",
  "fallbackPrinter": "Your Printer Name"
}
```

- `serverUrl`: Use `localhost:3000` for local testing. Use your PC's local IP (e.g. `192.168.1.100:3000`) when the agent runs on a different PC
- `agentToken`: Must be `dev-agent` — must match `.env` AGENT_TOKEN
- `sumatraPath`: Optional. Leave empty to auto-detect the bundled print engine or a system install
- `fallbackPrinter`: Default printer name shown when no printer is selected in admin

---

## Architecture

```
Customer (mobile)
  └── uploads file → POST /api/uploads → gets token
Admin (browser)
  └── GET /admin → dashboard (SSE live updates)
  └── POST /api/admin/jobs/[id] → mark paid / release
Print Agent (Windows PC)
  └── GET /api/agent/jobs/next → polls approved jobs
  └── GET /api/agent/jobs/[id]/file → downloads file
  └── POST /api/agent/jobs/[id]/status → marks printed
```

**Database:** Dual-mode — SQLite (`better-sqlite3`) for local/dev, Supabase (PostgreSQL) for production. Controlled by `USE_SUPABASE` env var. Both share the same schema and query interface via `src/lib/db.ts` / `src/lib/db-supabase.ts`.

**Auth:**
- Admin: session-based (cookie), `admin_users` table
- Agent: bearer token, hashed in `agent_tokens` table
- Customers: no auth required

**File storage:**
- Originals: `uploads/originals/`
- Converted: `uploads/converted/`
- Agent temp: `agent-temp/`

**Tables:** `jobs`, `job_files`, `pricing_config`, `admin_users`, `agent_tokens`, `agent_config`, `agent_printers`, `print_events`

---

## Features

- **Customer upload** — PDF, JPG, PNG, DOC/DOCX support via mobile
- **Print settings** — B/W or color, copies, page range, paper size (A4/A5/A3/B5/Letter/Legal/Photo), layout, scale
- **Live admin dashboard** — SSE updates, expiry countdown, queue position, status badges
- **Printer selection** — choose active printer from admin dashboard, agent fetches it automatically
- **Batch actions** — select multiple jobs and mark paid in one click
- **Pricing config** — B/W/color rates, paper size multipliers, job expiry time
- **Job editing** — change copies, pages, paper size, layout, margins, pages-per-sheet before release (locked when printing)
- **DOC/DOCX conversion** — auto-converted to PDF via LibreOffice (`npm run convert` or the admin convert endpoint); page count and price recomputed
- **Auto cleanup** — finished and expired-unpaid jobs (plus their files) removed on a schedule

---

## Printing Flow

1. Customer uploads file → receives token + queue position
2. Admin marks job "paid" → customer pays at counter
3. Admin clicks "Release Print" → job status becomes `approved`
4. Agent picks up the job → downloads file → sends it to the bundled print engine
5. Agent marks job "printed" → done

---

## Commands

```powershell
npm run dev        # Start development server
npm run build      # Build for production
npm run start      # Start production server
npm run typecheck  # Type check only
npm run db:seed    # Initialize/seed local SQLite database
npm run cleanup    # Delete finished + expired jobs and their files
npm run convert    # Convert pending DOC/DOCX uploads to PDF (needs LibreOffice)

npm run agent      # Developer CLI agent. For shop use, prefer the Electron installer.
```

---

## Default Values

| | Value |
|---|---|
| Admin | `admin` / `1234` |
| Agent token | `dev-agent` |
| B/W per page | ₹2 |
| Color per page | ₹10 |
| Job expiry | 24 hours |

Pricing is configurable from the admin dashboard Settings panel.

---

## DOC/DOCX Conversion

DOC/DOCX uploads are stored with `needs_conversion = 1` and cannot be released until converted to PDF. Conversion uses **LibreOffice headless**.

1. Install LibreOffice on the machine running the web app (or set `LIBREOFFICE_PATH` to `soffice(.exe)`).
2. Convert pending documents:
   - **Batch script:** `npm run convert` — processes every pending DOC/DOCX.
   - **On demand:** `POST /api/admin/jobs/<id>/convert` (admin session) — converts one job.

Conversion replaces the stored file with the PDF, deletes the original, and recomputes page count and price. The print agent still applies the job's paper size/scale at print time.

## Maintenance / Cleanup

`cleanupOldJobs` removes finished jobs (`printed`/`cancelled`/`failed`) and unpaid jobs older than the configured expiry, along with their stored files.

- **Manual:** `npm run cleanup`
- **HTTP:** `GET`/`POST /api/cleanup` — protected by `CRON_SECRET` (falls back to `AGENT_TOKEN`). Send `Authorization: Bearer <secret>` or `?key=<secret>`.
- **Vercel Cron:** `vercel.json` schedules `/api/cleanup` daily at 03:00. Set `CRON_SECRET` in the project env so Vercel's cron requests authenticate.
- **Self-hosted/shop PC:** schedule `npm run cleanup` (and `npm run convert`) via Windows Task Scheduler / cron.

## Optional Environment Variables

| Var | Purpose |
|---|---|
| `LIBREOFFICE_PATH` | Path to `soffice(.exe)` if not auto-detected |
| `CRON_SECRET` | Bearer secret for `/api/cleanup` |
| `MAX_UPLOAD_MB` | Upload size limit (default 25) |
| `SESSION_SECRET` | Admin session signing secret (set in production) |

## Known Limitations

- **No admin pagination UI**: the API supports `?page=` / `?limit=` (default 100 newest, batched file fetch — no longer loads the whole table), but the dashboard currently renders the first page only.
- **File serve**: no rate limiting on `/uploads/[id]`. Do not expose directly to the public internet without a reverse proxy.
