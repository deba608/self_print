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
| `/` | Customer | Upload files and configure print settings |
| `/login` | Customer | Sign in (optional — guests can upload without an account) |
| `/register` | Customer | Create an account for order history |
| `/my-jobs` | Customer | Past orders (requires login) |
| `/track` | Customer | Track an order by token |
| `/admin` | Staff | Login and dashboard |

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

```env
AGENT_TOKEN=change-me-to-a-random-secret
```

Supabase is required for customer/staff login. Add these for auth:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

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
