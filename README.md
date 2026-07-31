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

Staff are invite-only. Create the first super admin manually:

1. Supabase Dashboard → Authentication → Add user
2. Insert a matching row in `staff_profiles` with `role = 'super_admin'`

Existing admins can invite more staff from the dashboard.

### Print Agent

Copy `agent/config.example.json` to `agent/config.json` and configure:

```json
{
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseKey": "your-service-role-key",
  "fallbackPrinter": "Your Printer Name"
}
```

Run `.\agent\START-PRINTER.bat`. For auto-start on boot, run `agent\INSTALL-AUTOSTART.bat` once.

## Features

- Upload PDF, JPG, PNG, DOC/DOCX via mobile data
- Print settings: B/W or color, copies, page range, paper size, layout, scale, duplex, pages-per-sheet
- Optional customer accounts with order history
- Invite-only staff accounts (super admin / admin)
- Live admin dashboard with SSE updates
- Printer selection, batch payment mark, configurable pricing
- Home delivery as an alternative to counter pickup
- DOC/DOCX to PDF conversion via LibreOffice
- Auto-cleanup of finished and expired jobs
