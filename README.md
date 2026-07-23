# Self_Print

QR-friendly self-service print queue for Xerox shops. Customers scan a QR code, upload files, select print settings, get a token, pay at counter, staff release from admin dashboard. Windows agent polls approved jobs and prints.

## Quick Start

```powershell
npm install
npm run db:seed
npm run dev
```

Customer: `http://localhost:3000/`
Admin: `http://localhost:3000/admin`

---

## Setup

### Environment

Create a `.env` file:

```env
AGENT_TOKEN=change-me-to-a-random-secret
```

For production (Supabase), add your project URL and service role key. The app auto-detects Supabase mode — no toggle needed.

### Print Agent (Shop PC)

Copy `agent/config.example.json` to `agent/config.json` and configure:

```json
{
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseKey": "your-service-role-key",
  "fallbackPrinter": "Your Printer Name"
}
```

Run: `.\START-PRINTER.bat`

For auto-start: double-click `INSTALL-AUTOSTART.bat` (one time).

---

## Commands

```powershell
npm run dev        # Development server
npm run build      # Production build
npm run typecheck  # Type check
npm run db:seed    # Seed local SQLite database
npm run cleanup    # Remove finished + expired jobs
npm run convert    # Convert DOC/DOCX to PDF (requires LibreOffice)
npm run agent      # Start print agent
```

---

## Features

- Upload PDF, JPG, PNG, DOC/DOCX via mobile
- Print settings: B/W or color, copies, page range, paper size, layout, scale
- Live admin dashboard with SSE updates
- Printer selection from dashboard
- Batch payment mark
- Configurable pricing
- DOC/DOCX to PDF conversion via LibreOffice
- Auto-cleanup of finished and expired jobs

---

## Known Limitations

- No admin pagination UI (API supports `?page=` / `?limit=`)
- No rate limiting on file serve endpoints
