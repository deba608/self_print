# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Self_Print is a QR-friendly print queue system for Xerox shops. Customers scan a QR code, upload files using their mobile data, select print settings, receive a token, pay at the counter, and staff release jobs from an admin dashboard. A Windows Node.js agent polls approved jobs and prints via SumatraPDF.

Tech stack: Next.js 15, React 19, TypeScript, SQLite (better-sqlite3), Node.js print agent.

## Commands

```powershell
npm run dev        # Start development server
npm run build      # Build for production
npm run typecheck  # Type check only
npm run db:seed    # Initialize/seeds SQLite database
npm run cleanup    # Delete printed/cancelled/expired uploads
npm run agent      # Run Windows print agent (on shop PC)
```

## Architecture

- **Customer UI**: Root page (`/`) - mobile-first upload form for PDF/JPG/PNG/DOC/DOCX
- **Admin UI**: `/admin` - login-protected dashboard for job queue, preview, payment/release actions
- **Print Agent**: `agent/src/index.ts` - polls approved jobs, downloads, prints via SumatraPDF, updates status
- **API Routes**: `src/app/api/` - jobs, admin/*, agent/*, uploads/*
- **Lib**: `src/lib/` - db.ts, config.ts, files.ts, pricing.ts, security.ts, types.ts

## Key Design Decisions

- Manual counter payment: jobs must be marked "paid" before release
- DOC/DOCX handling: stored but marked `needsConversion`, cannot be released until converted
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
2. Set `serverUrl` to your server address (e.g., `http://localhost:3000` for local, or `http://YOUR_PC_IP:3000` for shop PC)
3. Set `sumatraPath` to your SumatraPDF installation path
4. Set `fallbackPrinter` to your default printer name (shown when no printer selected in admin)
5. Keep `agentToken: "dev-agent"` — must match `.env` AGENT_TOKEN
6. Run `npm run agent` on the shop PC

## Printing Flow

1. Customer uploads file → gets token + queue position
2. Admin marks job "paid" → customer pays at counter
3. Admin clicks "Release Print" → status becomes "approved"
4. Agent polls every 5 seconds, picks up approved job
5. Agent downloads file, prints via SumatraPDF to selected printer
6. Agent marks job "printed" → done