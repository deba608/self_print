# Self_Print

QR-friendly self-service print queue for Xerox shops. Customers scan a QR code, upload files, select print settings, get a token, pay at counter, staff release from admin dashboard. Windows agent polls approved jobs and prints.

## Quick Start

```powershell
npm install
npm run db:seed
npm run dev
```

| URL | Who | What |
|---|---|---|
| `http://localhost:3000/` | Customer | Upload + print settings (no login required) |
| `http://localhost:3000/login` | Customer | Sign in to an existing account |
| `http://localhost:3000/register` | Customer | Create an account (optional — guests can upload without one) |
| `http://localhost:3000/my-jobs` | Customer | Order history (requires login) |
| `http://localhost:3000/admin` | Staff | Sign-in form when signed out; the dashboard itself once authenticated — same URL |

`/customer-login` (old path) permanently redirects to `/login`.

---

## Setup

### Environment

Create a `.env` file:

```env
AGENT_TOKEN=change-me-to-a-random-secret
```

For production (Supabase), add your project URL and service role key. The app auto-detects Supabase mode — no toggle needed.

Customer/staff login requires Supabase Auth, configured separately:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Without these, guest upload still works fully on plain SQLite — there's just no login. See `docs/LOCAL_DEV_AUTH.md` for running real Supabase Auth locally.

### Staff Accounts

Staff accounts are invite-only — there's no public sign-up for `/admin`. Create the first super-admin manually:

1. Supabase Dashboard → Authentication → add user
2. Insert a matching row in `staff_profiles` with `role = 'super_admin'`

After that, staff can invite teammates from the dashboard (`/admin` → Staff).

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
npm run test       # Run tests (vitest)
npm run db:seed    # Seed local SQLite database
npm run cleanup    # Remove finished + expired jobs
npm run convert    # Convert DOC/DOCX to PDF (requires LibreOffice)
npm run agent      # Start print agent
```

---

## Features

- Upload PDF, JPG, PNG, DOC/DOCX via mobile
- Print settings: B/W or color, copies, page range, paper size, layout, scale
- Optional customer accounts with order history (`/my-jobs`) — guest upload works without one
- Invite-only staff accounts with role-based access (`super_admin` / `admin`)
- Live admin dashboard with SSE updates
- Printer selection from dashboard
- Batch payment mark
- Configurable pricing
- Home delivery as an alternative to counter pickup
- DOC/DOCX to PDF conversion via LibreOffice
- Auto-cleanup of finished and expired jobs

---

## Known Limitations

None currently tracked. Admin job list is cursor-paginated with a "Load more" control (works while filtered by status too), and every public/token-based endpoint plus the admin/agent file-serve routes are rate-limited per IP.
