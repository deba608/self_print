# SelfPrint Xerox

SelfPrint is a QR-friendly self-service print queue for a Xerox shop. Customers scan a QR code, upload files using their own mobile data, select print settings, receive a token, pay at the counter, and staff release the job from the admin dashboard. A Windows Node.js agent on the shop PC polls approved jobs and prints through SumatraPDF.

## Features

- **Customer upload page** — mobile-first, PDF/JPG/PNG/DOC/DOCX support
- **Print options** — B/W or color, copies, page range, paper size (A4/Letter/Legal/Photo), layout, pages per sheet, margins, scale
- **Real-time admin dashboard** — SSE live updates, batch actions, job selection, expiry countdown
- **Printer selection** — admin chooses active printer from dashboard, agent picks it up automatically
- **Admin job editing** — change copies, page range, paper size, layout, scale before release (locked when printing)
- **Queue position** — each job gets a numbered position in queue
- **Expiry countdown** — live countdown timer on every job, warning when expiring soon
- **Batch actions** — select multiple pending jobs and mark paid in one click
- **Pricing config** — configurable expiry time, B/W/color per page, copy/paper multipliers
- **SSE notifications** — admin gets a badge when new jobs arrive without manual refresh
- **Logout button** — admin can log out cleanly
- **DOC/DOCX handling** — stored but marked as needs conversion, cannot be released until converted
- **SQLite database** with WAL mode, foreign keys, and audit log via print_events
- **Configurable agent** — printer fetched from server, no need to edit agent config for printer changes

## Default Credentials

| | |
|---|---|
| Admin URL | `http://localhost:3000/admin` |
| Username | `admin` |
| Password/PIN | `1234` |
| Agent token | `selfprint-agent-token-9Kp4Lm72Qx` |

Change these in `.env` before production use.

## Setup

### 1. Web App

Install Node.js 20+, then:

```powershell
git clone <repo>
cd selfprint
npm install
cp .env.example .env
npm run db:seed
npm run dev
```

Print the customer URL as a QR code:
```
http://<shop-pc-ip>:3000/
```

### 2. Windows Print Agent

1. Install [SumatraPDF](https://www.sumatrapdfreader.org/free-pdf-reader) on the shop PC.
2. Copy `agent/config.example.json` to `agent/config.json`.
3. Edit `agent/config.json`:
   - `serverUrl` — your web app URL (e.g. `http://192.168.1.100:3000`)
   - `agentToken` — must match `AGENT_TOKEN` in `.env`
   - `sumatraPath` — path to SumatraPDF.exe (e.g. `C:\Program Files\SumatraPDF\SumatraPDF.exe`)
   - `fallbackPrinter` — default printer name if server printer is not set
4. Start the agent:

```powershell
npm run agent
```

The agent writes logs to `agent/agent.log`, downloads approved jobs to `agent-temp/`, prints them, and removes temp files.

**Printer selection:** The admin can choose the active printer from the dashboard (`/admin` → Printer button). The agent fetches this setting automatically — no need to restart or edit the agent config when switching printers.

## Customer Flow

1. Customer scans QR code.
2. Customer uploads a PDF, JPG, PNG, or DOC/DOCX file.
3. Customer selects B/W or color, copies, page range, paper size.
4. Advanced options: layout (portrait/landscape), pages per sheet, margins, scale.
5. App shows an estimated price.
6. Customer submits and receives a token number and queue position.
7. Customer pays at the counter using the token.
8. Staff approves the job — the agent auto-prints it.

## Admin Flow

1. Staff opens `/admin` and logs in.
2. Staff sees live job list with queue positions, expiry countdowns, and status badges.
3. Staff can select multiple pending jobs and mark them all paid at once (batch action).
4. Staff marks a job paid, then approves/release — the agent picks it up and prints.
5. Staff can edit print settings (copies, pages, paper, layout) before release.
6. Staff marks printed, cancels, or reprints as needed.
7. Staff can change the active printer from the Printer button in the header.
8. Staff can update pricing and expiry time from the Settings panel.

## Pricing Defaults

| Setting | Value |
|---|---|
| B/W per page | ₹2 |
| Color per page | ₹10 |
| Photo print | ₹30 |
| Copy multiplier | 1 |
| Legal multiplier | 1.25 |
| Job expiry | 1440 min (24 hours) |

These are configurable from the admin dashboard's Settings panel.

## Security Notes

- Customers do not log in and cannot browse uploaded files.
- Uploaded files are served only through admin or agent authenticated endpoints.
- Admin release is required before printing.
- Agent API requires a bearer token matching `AGENT_TOKEN`.
- Session cookies are httpOnly and signed.
- Run `npm run cleanup` periodically to delete printed, cancelled, or expired uploads.

## Commands

```powershell
npm run dev        # Start development server
npm run build      # Build for production
npm run start      # Start production server
npm run typecheck  # Type check only
npm run db:seed    # Initialize/seed SQLite database
npm run cleanup    # Delete printed/cancelled/expired uploads
npm run agent      # Run Windows print agent
```