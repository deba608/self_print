# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SelfPrint is a QR-friendly print queue system for Xerox shops. Customers scan a QR code, upload files using their mobile data, select print settings, receive a token, pay at the counter, and staff release jobs from an admin dashboard. A Windows Node.js agent polls approved jobs and prints via SumatraPDF.

Tech stack: Next.js 15, React 19, TypeScript, SQLite (better-sqlite3), Node.js print agent.

## Commands

```powershell
npm run dev        # Start development server
npm run build      # Build for production
npm run typecheck  # Type check only
npm run db:seed    # Initialize/seeds SQLite database
npm run cleanup    # Delete printed/cancelled/expired uploads
npm run agent      # Run Windows print agent
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
- Agent API uses bearer token auth
- Admin uses session-based auth

## Database

SQLite schema auto-initializes in `src/lib/db.ts`. Tables: `jobs`, `job_files`, `pricing_config`, `admin_users`, `agent_tokens`, `print_events`.

## Environment Variables

See `.env` for runtime config. Key variables: `SESSION_SECRET`, `ADMIN_PASSWORD`, `AGENT_TOKEN`, `DATABASE_PATH`, `UPLOAD_DIR`.

## Default Credentials

- Admin: `admin` / `1234`
- Agent token: `dev-agent-token-change-me`

## File Storage

- Original uploads: `uploads/originals/`
- Converted files: `uploads/converted/`
- Agent temp: `agent-temp/`
- Agent config: `agent/config.json` (copy from `agent/config.example.json`)