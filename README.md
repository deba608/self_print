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

Ensure SumatraPDF is installed or placed in `agent/vendor/SumatraPDF.exe`, and that `agent/config.json` is configured. Then run:

```powershell
npm run agent
```

For production shop use, use the Windows batch file `START-PRINTER.bat` to run the agent with auto-restart on network disconnect or crash:
```powershell
.\START-PRINTER.bat
```

To run it completely hidden in the background:
```powershell
.\START-PRINTER-BACKGROUND.vbs
```

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

# (Optional, highly recommended for production performance)
# Direct Client-to-Supabase uploads (bypasses Vercel upload double-hop)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Supabase mode activates automatically when both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set; otherwise the app falls back to local SQLite. There is no separate toggle flag.

When `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are provided, the browser uploads files **directly to Supabase Storage**, bypassing the Vercel server proxy (faster, and avoids Vercel's request body limit). It uses **signed upload URLs**: the browser first calls `POST /api/uploads/sign`, the server validates the file and returns a short-lived upload token bound to a server-chosen path, then the browser uploads with that token. The Storage bucket stays **private** — no anonymous insert policy is required.

> **Security:** `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and has full DB access. Use it server-side only — never expose it to the browser or commit it. The print agent (`agent/config.json`) also uses a service-role key; keep that file out of version control. The browser only ever holds the `anon` public key, and uploads are authorized per-file by a server-issued signed token.

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

6. **Storage bucket (`selfprint`) — keep it private.** Direct uploads use server-issued signed upload URLs, so **no anonymous insert policy is needed**. Lock the bucket down instead:

   ```sql
   UPDATE storage.buckets
   SET public = false,
       file_size_limit = 26214400,  -- 25 MB
       allowed_mime_types = ARRAY[
         'application/pdf','image/jpeg','image/png',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       ]
   WHERE id = 'selfprint';
   ```

   Reads (admin preview, agent download) are served via short-lived signed URLs minted server-side with the service-role key. No `storage.objects` policies are required because all access goes through the service role.

### Print Agent

The Print Agent is a Node.js process that runs on the shop's Windows PC. It listens for print commands in real time via Supabase Realtime, downloads the PDF file, and prints it silently using SumatraPDF.

#### 1. Install SumatraPDF (Print Engine)
The agent needs SumatraPDF to run. You can configure it in one of three ways:
* **Recommended:** Download the portable version of SumatraPDF.exe and place it directly inside `agent/vendor/SumatraPDF.exe`.
* Install SumatraPDF on the client's PC (the agent automatically checks standard locations like `C:\Program Files\SumatraPDF\SumatraPDF.exe`).
* Install it anywhere and specify the custom path in `agent/config.json` via the `sumatraPath` property.

#### 2. Create and Configure `agent/config.json`
Copy `agent/config.example.json` to `agent/config.json` and fill in your Supabase project settings:

```json
{
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseKey": "your-service-role-key",
  "sumatraPath": "",
  "tempDir": "./agent-temp",
  "maxRetries": 3,
  "fallbackPrinter": "Your Printer Name"
}
```

* **`supabaseUrl`**: Your project URL from the Supabase dashboard (Settings -> API).
* **`supabaseKey`**: Your service role key (`service_role` / `secret` key) from Supabase API settings. *(Must be the service role key, not the anon key).*
* **`sumatraPath`**: (Optional) Path to your `SumatraPDF.exe` if not placed in `agent/vendor` or standard Program Files directories.
* **`fallbackPrinter`**: (Optional) The name of the printer to use if no printer is selected on the admin dashboard.

#### 3. Run the Agent
To start the print agent:
```powershell
npm run agent
```

For production/shop use, run the Windows batch file launcher which auto-restarts the agent if it crashes or loses network connection:
```powershell
.\START-PRINTER.bat
```

To run the agent **completely in the background (hidden window)**, double-click:
```powershell
.\START-PRINTER-BACKGROUND.vbs
```

Once running, the agent automatically detects all installed Windows printers and reports them to the database so you can choose which printer to use in the Admin dashboard.

---

## Architecture

```
Customer (mobile)
  ├── (cloud) POST /api/uploads/sign → signed URL → upload bytes direct to Supabase Storage
  ├── (local) POST /api/jobs with file → server stores it
  └── POST /api/jobs (metadata) → server verifies file, prices, returns token
Admin (browser)
  └── GET /admin → dashboard (SSE live updates)
  └── POST /api/admin/jobs/[id] → mark paid / release
  └── GET /api/uploads/[id] → preview (redirects to signed URL on cloud)
Print Agent (Windows PC)
  └── GET /api/agent/jobs/next → polls approved jobs
  └── GET /api/agent/jobs/[id]/file → signed download URL
  └── POST /api/agent/jobs/[id]/status → marks printed
```

**Database:** Dual-mode — SQLite (`better-sqlite3`) for local/dev, Supabase (PostgreSQL) for production. Auto-selected by presence of `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (no toggle flag). Both share the same schema and query interface via `src/lib/db.ts` / `src/lib/db-supabase.ts`.

**Storage:** Local filesystem for dev; private Supabase Storage bucket for production. Uploads go direct from the browser via signed upload URLs; reads use short-lived signed download URLs. Object paths are server-controlled.

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

npm run agent      # Start print agent (connects to Supabase)
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
