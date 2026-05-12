# SelfPrint Xerox MVP

SelfPrint is a QR-friendly print queue for a Xerox shop. Customers upload using their own mobile data, choose settings, receive a token, pay at the counter, and staff releases the job from the admin dashboard. A Windows Node.js agent on the shop PC polls approved jobs and prints through SumatraPDF.

## Features

- Customer upload page with PDF, JPG, PNG, DOC, and DOCX support.
- DOC/DOCX files are stored but marked as needing conversion.
- SQLite database with local file storage in `uploads/`.
- Admin password/PIN login.
- Job preview, status actions, reprint, and daily sales summary.
- Token-protected Windows print agent.
- Configurable pricing seeded into SQLite.

## Default Credentials

- Admin URL: `http://localhost:3000/admin`
- Username: `admin`
- Password/PIN: `1234`
- Agent token: `dev-agent-token-change-me`

Change these in `.env` before real shop use.

## Setup

1. Install Node.js 20 or newer.
2. Install SumatraPDF on the Windows shop PC.
3. Copy `.env.example` to `.env` and edit `SESSION_SECRET`, `ADMIN_PASSWORD`, and `AGENT_TOKEN`.
4. Install dependencies:

```powershell
npm install
```

5. Initialize/seed SQLite:

```powershell
npm run db:seed
```

6. Start the web app:

```powershell
npm run dev
```

7. Print the customer URL as a QR code:

```text
http://<shop-pc-ip>:3000/
```

## Windows Print Agent

1. Copy `agent/config.example.json` to `agent/config.json`.
2. Set:
   - `serverUrl` to the web app URL.
   - `agentToken` to the same token from `.env`.
   - `printerName` to the exact Windows printer name.
   - `sumatraPath` to the installed SumatraPDF executable.
3. Start the agent:

```powershell
npm run agent
```

The agent writes logs to `agent/agent.log`, downloads approved jobs to `agent-temp/`, prints them, updates the backend status, and removes the temp file.

## Customer Flow

1. Customer scans QR code.
2. Customer uploads PDF/JPG/PNG or a DOC/DOCX file.
3. Customer selects print type, copies, page range, and paper size.
4. App shows an estimated price.
5. Customer submits and receives a token number.
6. Customer pays at the counter using the token.

## Admin Flow

1. Staff opens `/admin` and logs in.
2. Staff reviews pending jobs and preview files.
3. Staff marks payment as paid.
4. Staff approves/releases the job.
5. The Windows agent prints the job.
6. Staff can mark printed, cancel, or reprint when needed.

## Pricing Defaults

- B/W: ₹2 per page
- Color: ₹10 per page
- Photo: ₹30 per print
- A4 multiplier: `1`
- Legal multiplier: `1.25`
- Photo multiplier: `1`

The seeded pricing lives in the `pricing_config` table.

## Security Notes

- Customers do not log in and cannot browse uploaded files.
- Uploaded files are served only through admin or agent authenticated endpoints.
- Admin release is required before printing.
- Agent API requires a bearer token.
- Run `npm run cleanup` periodically to delete printed, cancelled, or expired uploads.

## Current Environment Note

During scaffolding, this machine reported `node.exe` access denied and `npm` missing from PATH. Fix the local Node.js installation or use a proper Node.js 20+ install before running `npm install`.