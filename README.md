# Self_Print

A QR-friendly self-service print queue for Xerox shops. Customers scan a QR code, upload files using their own mobile data, select print settings, receive a token, pay at the counter, and staff release the job from the admin dashboard. A Windows Node.js agent on the shop PC polls approved jobs and prints through SumatraPDF.

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

The agent polls for approved jobs every 5 seconds, downloads files, and prints via SumatraPDF.

---

## Setup

### Environment

Create a `.env` file with just one required setting:

```
AGENT_TOKEN=dev-agent
```

Everything else uses safe defaults. Admin login: `admin` / `1234`

### Print Agent

1. Install [SumatraPDF](https://www.sumatrapdfreader.org/free-pdf-reader) on the shop PC
2. Copy `agent/config.example.json` → `agent/config.json`
3. Edit these values in `agent/config.json`:

```json
{
  "serverUrl": "http://localhost:3000",
  "agentToken": "dev-agent",
  "sumatraPath": "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
  "fallbackPrinter": "Your Printer Name"
}
```

- `serverUrl`: Use `localhost:3000` for local testing. Use your PC's local IP (e.g. `192.168.1.100:3000`) when the agent runs on a different PC
- `agentToken`: Must be `dev-agent` — must match `.env` AGENT_TOKEN
- `sumatraPath`: Path to SumatraPDF.exe on your PC
- `fallbackPrinter`: Default printer name shown when no printer is selected in admin

---

## Features

- **Customer upload** — PDF, JPG, PNG, DOC/DOCX support via mobile
- **Print settings** — B/W or color, copies, page range, paper size (A4/A5/A3/B5/Letter/Legal/Photo), layout, pages per sheet, margins, scale
- **Live admin dashboard** — SSE updates, expiry countdown, queue position, status badges
- **Printer selection** — choose active printer from admin dashboard, agent fetches it automatically
- **Batch actions** — select multiple jobs and mark paid in one click
- **Pricing config** — B/W/color rates, paper size multipliers, job expiry time
- **Job editing** — change copies, pages, paper size before release (locked when printing)
- **DOC/DOCX handling** — stored but needs manual conversion before release

---

## Printing Flow

1. Customer uploads file → receives token + queue position
2. Admin marks job "paid" → customer pays at counter
3. Admin clicks "Release Print" → job status becomes `approved`
4. Agent picks up the job → downloads file → prints via SumatraPDF
5. Agent marks job "printed" → done

---

## Commands

```powershell
npm run dev        # Start development server
npm run build      # Build for production
npm run start      # Start production server
npm run typecheck  # Type check only
npm run db:seed    # Initialize/seed SQLite database
npm run cleanup    # Delete old printed/cancelled/expired uploads
npm run agent      # Run Windows print agent
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