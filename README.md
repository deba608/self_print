# Self_Print

QR-friendly self-service print queue for Xerox shops. Customers scan a QR code, upload files from their phone, select print settings, get a token, pay at the counter, and staff release jobs from an admin dashboard. A Windows agent polls approved jobs and prints via the system spooler.

## Quick Start

```powershell
npm install
npm run db:seed
npm run dev
```

| URL | For | What |
|---|---|---|
| `/` | Customer | Upload files (single or 2-10 PDF batch) and configure print settings |
| `/login` / `/register` | Customer | Optional account — guests can upload without one |
| `/account` | Customer | Profile editor (name, avatar) |
| `/my-jobs` | Customer | Past orders (requires login) |
| `/track` | Customer | Track an order by token |
| `/admin` | Staff | Login and live job dashboard |
| `/admin/orders` | Staff | Order management with filters and search |
| `/admin/customers` | Staff | Customer directory with order history and CSV export |
| `/admin/accounts` | Staff | Customer account administration |
| `/admin/staff` | Staff | Staff invitations and role management |
| `/admin/security` | Staff | Login events and security review |

## How It Works

### System Architecture

```mermaid
flowchart LR
    subgraph Client
        C[Customer phone<br/>upload + track]
        S[Staff browser<br/>/admin dashboard]
    end

    subgraph Vercel["Next.js on Vercel"]
        API[API routes<br/>jobs / uploads / payments / admin]
    end

    subgraph Supabase
        DB[(Postgres<br/>jobs, job_files,<br/>staff_profiles)]
        ST[(Storage<br/>bucket: selfprint)]
        AU[Auth<br/>staff + customers]
        RT[Realtime]
    end

    subgraph Shop["Shop PC (Windows)"]
        AG[Print agent<br/>agent/src/index.ts]
        PR[Printer<br/>via GDI spooler]
    end

    C --> API
    S --> API
    API --> DB
    API --> ST
    API --> AU
    C -.direct signed upload.-> ST
    DB -.job approved.-> RT
    RT --> AG
    AG -.5s polling fallback.-> DB
    AG --> ST
    AG --> PR
```

### Customer Order Flow

```mermaid
sequenceDiagram
    participant U as Customer
    participant W as Web app
    participant API as API routes
    participant ST as Supabase Storage
    participant DB as Database

    U->>W: Scan QR, open /
    U->>W: Pick file + print settings
    W->>API: POST /api/uploads/sign
    API-->>W: Signed upload URL + HMAC
    W->>ST: PUT file directly
    W->>API: POST /api/jobs (settings, storedName, sig)
    API->>API: Verify HMAC, validate type/size, calculate price
    API->>DB: Insert job (status=pending, token)
    API-->>U: 6-digit token + price
    U->>W: Pay online (Razorpay/UPI) or at counter
    U->>W: Track at /track with token
```

### Staff & Print Flow

```mermaid
sequenceDiagram
    participant S as Staff (/admin)
    participant API as API routes
    participant DB as Database
    participant AG as Print agent
    participant PR as Printer

    S->>API: Login (Supabase Auth)
    API->>DB: Check staff_profiles row
    API-->>S: Dashboard (live SSE updates)
    S->>API: Preview job, mark paid, Approve
    API->>DB: status = approved
    DB-->>AG: Realtime event (or 5s poll)
    AG->>DB: Claim job, status = printing
    AG->>AG: Download file, rasterize PDF (PDFium)
    AG->>PR: print-image.ps1 (Windows GDI)
    AG->>DB: status = printed
    DB-->>S: SSE update on dashboard
```

### Job Status Lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: Customer submits
    pending --> approved: Staff releases
    pending --> rejected: Staff rejects
    approved --> printing: Agent claims
    printing --> printed: Print succeeds
    printing --> failed: Print error
    printing --> approved: Stale >10 min (cleanup cron)
    failed --> approved: Staff retries
    printed --> [*]: Cleanup removes job + files
    rejected --> [*]
```

Payment is tracked independently of status: `paidAt` is the single source of truth, so a job can print before or after payment.

### Auth & Access Control

```mermaid
flowchart TD
    R[Request] --> M[middleware.ts<br/>refresh session cookie<br/>verify via getClaims]
    M --> T{Route type}
    T -->|Public: / /track| OK[Serve]
    T -->|/admin page| A{Valid session AND<br/>staff_profiles row?}
    A -->|Yes| D[Render dashboard]
    A -->|No| L[Render login form]
    T -->|/api/admin/*| B{requireAdminResponse}
    B -->|Pass| H[Handler]
    B -->|Fail| E401[401 Admin login required]
    T -->|/api/cleanup| CS{CRON_SECRET<br/>timing-safe compare}
    CS -->|Pass| CL[Run cleanup]
    CS -->|Fail| E403[401]
```

Staff accounts are invite-only — there is no self-service path into `staff_profiles`. Destructive staff-management routes additionally require `role = 'super_admin'`.

## Commands

```powershell
npm run dev        # Start dev server
npm run build      # Build for production
npm run typecheck  # Type check
npm run test       # Run tests
npm run db:seed    # Seed SQLite database
npm run cleanup    # Remove finished + expired jobs
npm run convert    # Convert DOC/DOCX to PDF (needs LibreOffice)
npm run agent      # Start Windows print agent

npm run package:shop            # Bundle a ready-to-run agent zip for the shop PC
npm run package:shop -- --publish  # ...and publish it as a self-update payload
npm run agent:push-update       # Tell the shop PC to install the published update (CLI twin of the dashboard button)

node scripts/create-owner.mjs <email> <password>  # Create/upsert a super_admin staff account
```

## Setup

### Environment

Copy `.env.example` to `.env` and fill in what you need. Key variables:

| Variable | Required | Purpose |
|---|---|---|
| `AGENT_TOKEN` | Yes | Shared secret; protects `/api/cleanup` in dev when `CRON_SECRET` is unset |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Production | Switches the app from local SQLite to Supabase (Postgres + Storage) |
| `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For login | Supabase Auth for staff + customer accounts |
| `NEXT_PUBLIC_SITE_URL` | Production | Canonical base URL for auth emails (falls back to Vercel URL) |
| `SHOP_UPI_ID` / `SHOP_UPI_QR` + `SHOP_NAME` | Optional | UPI QR payment on the token screen (`SHOP_UPI_QR` for merchant stickers) |
| `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (+ `RAZORPAY_WEBHOOK_SECRET`) | Optional | Razorpay checkout with auto payment confirmation |
| `CRON_SECRET` | Production | Protects the cleanup cron endpoint |
| `MAX_UPLOAD_MB` | Optional | Per-file upload cap (default 50) |

Without Supabase env vars, the app runs on local SQLite — guest upload works, login is unavailable.

### Staff Accounts

Staff are invite-only. Create the first super admin either:

- Manually: Supabase Dashboard → Authentication → Add user, then insert a
  matching row in `staff_profiles` with `role = 'super_admin'`
- Or via script: `node scripts/create-owner.mjs <email> <password>` — creates
  the Supabase Auth user (or reuses it if it already exists) and upserts the
  `staff_profiles` row in one step. Requires `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` in `.env`.

Existing admins can invite more staff from the dashboard.

### Print Agent

Full non-technical walkthrough for setting this up on the shop PC (either
cloud-hosted or fully local) is in
[`docs/CLIENT_PC_SETUP.md`](docs/CLIENT_PC_SETUP.md). Short version for
developers:

Copy `agent/dev-tools/config.example.json` to `agent/config.json` and configure:

```json
{
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseKey": "your-service-role-key",
  "fallbackPrinter": ""
}
```

`fallbackPrinter` is only a startup default — the actual B/W and color
printer selection happens per-mode from the `/admin` dashboard's Printer
panel (`agent_config.bw_printer_name` / `color_printer_name`), which the
agent re-reads every 30s.

Run `.\agent\SETUP.bat` — one script that checks Node is installed,
registers the printer service to auto-start on every boot, and starts it
immediately. `agent\TEST-PRINTER.bat` sends a one-off test page to check the
printer connection. Everything else — `START-PRINTER.bat`,
`START-PRINTER-BACKGROUND.vbs`, `print-image.ps1` — is internal machinery
SETUP.bat depends on; leave it in place, no need to open it.
`agent\dev-tools\` holds developer/troubleshooting-only scripts
(`INSTALL-AUTOSTART.bat`/`start-agent.bat` — superseded by `SETUP.bat`,
kept for re-running just one half of that flow; `STOP-DEV-AGENT.bat` — kills
a stray agent process on a developer's own machine; `config.example.json` —
the config template).

To hand a ready-to-run package to a non-technical client (no `git clone`, no
config editing, `node_modules` pre-installed), run
`npm run package:shop` — bundles everything into
`dist-shop-package/selfprint-agent.zip`.

### Shipping an agent update

Once a shop PC is running the agent, new agent versions are pushed to it —
nobody has to touch the shop PC again.

One-time setup (per Supabase project):

- Apply `supabase/migrations/20260806000000_agent_self_update.sql` (adds the
  update columns on `agent_config` and the `agent_update_events` audit table).
- Create a **private** Storage bucket named `agent-updates`. The publish step
  does not create it for you.
- Leave `"updateMode": "manual"` in `agent/config.json` — it is the only mode
  implemented; anything else is refused at agent startup.

To ship a version:

1. Bump `agent/version.json` (dotted numeric, e.g. `1.0.0` → `1.0.1`). It must
   be strictly greater than what is already published, and a version that is
   already in the bucket cannot be republished.
2. `npm run package:shop -- --publish` — builds the zip, uploads
   `agent-<version>.zip`, then writes `latest.json` last so a half-finished
   publish never advertises a payload. It picks `kind: "code"` (just `agent/`)
   when no runtime dependency moved, `kind: "full"` (whole engine incl.
   `node_modules`) when they did.
3. Trigger the install: press **Install update** on the "Print agent" card in
   `/admin` → Printer panel (super admins only), or run
   `npm run agent:push-update` from the dev machine. Both write the same
   `agent_config` row; the agent picks it up within ~5s of its next poll.
4. Watch the card: `requested` → `downloading` → `swapping` → `success`. A job
   that is mid-print defers the update to the next poll.

When it goes wrong:

- **`failed`** — nothing was swapped, the old version is still running (bad
  sha256, missing/mismatched `latest.json`, the updater task would not launch,
  or a swap that never completed after a power loss). The reason is on the card.
- **`rolled_back`** — the new version was installed but never wrote a health
  heartbeat within 90s, so the previous version was restored automatically and
  restarted. The card turns red with the reason.

Where to look, in order: the "Print agent" card (status + message + last event),
`<shop-root>\update-staging\updater.log` (the swap script's own trace), and
`engine\agent\agent.log` (the agent's log). Markers left in the shop root
(`update-pending.txt`, `update-rollback.txt`, `agent-health.txt`) are the
handshake between the agent and the updater and are cleared on the next start.
If `updater.log` says `ROLLBACK FAILED`, the previous install is still sitting
in `engine.bak` / `engine\agent.bak` and needs a manual rename.

## Features

- Upload PDF, JPG, PNG, DOC/DOCX via mobile data
- Print settings: B/W or color, copies, page range, paper size, layout, scale, duplex, pages-per-sheet
- N-up printing (pages-per-sheet) billed by physical sheets used, not raw page count
- Optional customer accounts with order history
- Invite-only staff accounts (super admin / admin / delivery)
- Live admin dashboard with SSE updates
- Separate B/W and color printer selection, with per-job duplex-capability warnings
- Batch payment mark, configurable pricing
- Home delivery as an alternative to counter pickup, with optional GPS pin (skippable)
- Razorpay checkout — all dashboard-enabled payment methods, not UPI-only
- DOC/DOCX to PDF conversion via LibreOffice
- Auto-cleanup of finished and expired jobs
- One-click shop-PC agent setup package (`scripts/package-for-shop.mjs` + `agent/SETUP.bat`)
