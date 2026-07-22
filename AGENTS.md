# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Self_Print is a QR-friendly print queue system for Xerox shops. Customers scan a QR code, upload files using their mobile data, select print settings, receive a token, pay at the counter, and staff release jobs from an admin dashboard. A Windows Node.js agent polls approved jobs and prints via the Windows GDI spooler.

Tech stack: Next.js 15, React 19, TypeScript, SQLite (better-sqlite3), Node.js print agent.

## Commands

```powershell
npm run dev        # Start development server
npm run build      # Build for production
npm run typecheck  # Type check only
npm run db:seed    # Initialize/seeds local SQLite database
npm run cleanup    # Delete finished + expired jobs and their files
npm run convert    # Convert pending DOC/DOCX uploads to PDF (needs LibreOffice)
npm run agent      # Run Windows print agent (on shop PC)
```

## Architecture

- **Customer UI**: Root page (`/`) - mobile-first upload form for PDF/JPG/PNG/DOC/DOCX
- **Admin UI**: `/admin` - login-protected dashboard for job queue, preview, payment/release actions
- **Print Agent**: `agent/src/index.ts` - polls approved jobs, downloads, rasterizes PDFs to PNG (PDFium), prints via `agent/print-image.ps1` (Windows GDI `PrintDocument`), updates status
- **API Routes**: `src/app/api/` - jobs, admin/*, agent/*, uploads/*
- **Lib**: `src/lib/` - db.ts, config.ts, files.ts, pricing.ts, security.ts, types.ts

## Key Design Decisions

- Payment is decoupled from print progress: a job can be released/printed before it's paid (pay-at-counter-after-print flow). `paidAt` on the job is the sole source of truth for payment; it's set independently of `status` via `markJobPaid()` and never gates the `approved`/`printed` transitions. `status: "paid"` is a legacy value from before this change — old rows may still carry it; new jobs never do.
- DOC/DOCX handling: stored with `needsConversion=1`; converted to PDF via LibreOffice headless (`src/lib/convert.ts`, `npm run convert`, or `POST /api/admin/jobs/[id]/convert`)
- Dual database: SQLite (`db.ts`) for local, Supabase (`db-supabase.ts`) for production; auto-selected by presence of `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- Cleanup: `cleanupOldJobs` removes finished + expired-unpaid jobs and their files; run via `npm run cleanup` or `/api/cleanup` (Vercel Cron in `vercel.json`, auth via `CRON_SECRET`)
- Pricing is cached in-memory in `db.ts`; cache cleared on `updatePricing`
- No customer authentication required
- Agent API uses bearer token auth (`dev-agent`)
- Admin uses session-based auth

## Database

SQLite schema auto-initializes in `src/lib/db.ts`. Tables: `jobs`, `job_files`, `pricing_config`, `admin_users`, `agent_tokens`, `print_events`, `agent_config`, `agent_printers`.

## Environment Variables

Only `AGENT_TOKEN` is required in `.env`. All other settings use safe defaults.

```
AGENT_TOKEN=dev-agent
```

## Default Credentials

- Admin: `admin` / `1234`
- Agent token: `dev-agent` (must match in `.env` and `agent/config.json`)

## File Storage

- Original uploads: `uploads/originals/`
- Converted files: `uploads/converted/`
- Agent temp: `agent-temp/`
- Database: `data/selfprint.sqlite`

## Agent Setup

1. Copy `agent/config.example.json` to `agent/config.json`
2. Set `supabaseUrl` and `supabaseKey` (Service Role Key) to connect to your database
3. Set `fallbackPrinter` to your default printer name (used when no printer is selected in the admin dashboard)
4. Run `npm run agent`, `.\START-PRINTER.bat`, or `.\START-PRINTER-BACKGROUND.vbs` on the shop PC

## Printing Flow

1. Customer uploads file → gets token + queue position
2. Admin clicks "Release Print" → status becomes "approved" (payment not required)
3. Admin marks the job "Paid" whenever payment is collected — before or after release/printing; sets `paidAt` only, independent of status
4. Agent polls every 5 seconds, picks up approved job
5. Agent downloads file; PDFs are rasterized page-by-page to PNG (PDFium), images print directly; `agent/print-image.ps1` spools to the selected printer via `System.Drawing.Printing.PrintDocument`, honoring copies, color, layout, paper size, scale, margins, pages-per-sheet, and duplex
6. Agent marks job "printed" → done
