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

Create a `.env` file with just one required setting:

```
AGENT_TOKEN=dev-agent
```

Everything else uses safe defaults. Admin login: `admin` / `1234`

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

## Features

- **Customer upload** — PDF, JPG, PNG, DOC/DOCX support via mobile
- **Print settings** — B/W or color, copies, page range, paper size (A4/A5/A3/B5/Letter/Legal/Photo), layout, scale
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
4. Agent picks up the job → downloads file → sends it to the bundled print engine
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
