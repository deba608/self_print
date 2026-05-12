# CapsuleHub Capsule: SelfPrint Xerox MVP

## Capsule Metadata

- Name: SelfPrint Xerox MVP
- Date: 2026-05-09
- Workspace: `C:\Users\Dev\OneDrive\Desktop\Selfprint`
- Status: Implemented scaffold, dependencies present, local runtime artifacts exist
- Tech stack: Next.js, TypeScript, SQLite, local uploads, Node.js Windows print agent

## Original Goal

Build a self-service Xerox shop print system where customers scan a QR code, upload files using their own mobile data, choose print settings, receive a random token number, and shop staff approve/release jobs from an admin dashboard. The system must not require customer login, WhatsApp Web, or shop Wi-Fi.

## Product Decisions Locked During Conversation

- Payment flow: manual counter payment. Admin must mark the job paid before release.
- Windows printing: SumatraPDF-backed silent printing on the shop PC.
- DOC/DOCX handling: accept and store the upload, but mark as needing conversion. Do not auto-print DOC/DOCX in MVP.
- Database: SQLite for MVP.
- Storage: local `/uploads` directories.
- Admin auth: password/PIN login.
- Customer UI: mobile-first QR-friendly page.

## Implemented System

### Customer App

- Root page at `/`.
- Mobile-first upload form.
- Supports PDF, JPG, PNG, DOC, DOCX uploads.
- Allows print type, copies, page range, and paper size selection.
- Shows estimated price before submit.
- Creates random token and shows confirmation.
- DOC/DOCX jobs are created with conversion warning.

### Admin Dashboard

- Admin page at `/admin`.
- Login API using seeded username/password from env/defaults.
- Job queue with status, token, file name, price, and upload time.
- Job detail page with PDF/image preview.
- Shows file metadata, print options, page count, price, upload time, and event log.
- Actions implemented:
  - mark paid
  - approve/release print
  - cancel
  - mark printed
  - reprint
- Daily sales summary API and dashboard display.

### Backend and Storage

- SQLite schema is initialized automatically in `src/lib/db.ts`.
- Tables:
  - `jobs`
  - `job_files`
  - `pricing_config`
  - `admin_users`
  - `agent_tokens`
  - `print_events`
- Upload folders:
  - `uploads/originals`
  - `uploads/converted`
- Temp folder:
  - `agent-temp`
- Uploaded files are served only through authenticated admin/agent endpoints.

### Print Agent

- Node.js TypeScript agent lives in `agent/src/index.ts`.
- Reads `agent/config.json`.
- Polls `/api/agent/jobs/next`.
- Downloads approved file.
- Prints through SumatraPDF using configured printer name.
- Updates job status to `printing`, `printed`, or `failed`.
- Writes log file at `agent/agent.log`.
- Deletes temp file after print attempt.

## Important Files

- `package.json`: project scripts and dependencies.
- `README.md`: setup, default credentials, customer flow, admin flow, and agent instructions.
- `src/lib/db.ts`: schema initialization and default seeding.
- `src/lib/files.ts`: upload validation, storage, and page count estimation.
- `src/lib/pricing.ts`: pricing calculation.
- `src/lib/security.ts`: admin sessions and agent token verification.
- `src/app/api/jobs/route.ts`: customer job creation.
- `src/app/api/admin/**`: admin login, queue, job detail, status actions, summary.
- `src/app/api/agent/**`: print agent polling, file download, status updates.
- `src/components/UploadForm.tsx`: customer upload UI.
- `src/components/AdminDashboard.tsx`: admin queue UI.
- `src/components/JobDetail.tsx`: admin detail and preview UI.
- `agent/config.example.json`: sample print agent config.
- `scripts/seed.ts`: initializes database and prints defaults.
- `scripts/cleanup.ts`: deletes printed, cancelled, or expired uploads.

## Defaults

- Admin username: `admin`
- Admin password/PIN: `1234`
- Example agent token: `dev-agent-token-change-me`
- Default pricing:
  - B/W: INR 2 per page
  - Color: INR 10 per page
  - Photo: INR 30 per print
  - Legal multiplier: 1.25
  - A4 multiplier: 1
  - Photo multiplier: 1

Do not treat live `.env` or `agent/config.json` contents as safe to share; they may contain local secrets.

## Security and Workflow Rules

- Customer cannot browse or fetch arbitrary uploads.
- Admin routes require session auth.
- Agent routes require bearer token.
- Release requires job to be paid first.
- DOC/DOCX jobs cannot be released until converted.
- Random token numbers are generated for customer-facing pickup.
- Cleanup script can remove old/printed/cancelled uploads.

## Verification State

During the original implementation, system `node.exe` was blocked and `npm` was unavailable. Later workspace inspection showed:

- `node_modules` exists.
- `.next` exists.
- `package-lock.json` exists.
- `.env` exists.
- `agent/config.json` exists.
- `agent/agent.log` exists.

This suggests install/dev commands may have since been run locally. No secrets from `.env` or `agent/config.json` are included in this capsule.

Recommended next verification commands:

```powershell
npm run typecheck
npm run build
npm run db:seed
npm run dev
```

Agent run command:

```powershell
npm run agent
```

## Known Risks and Follow-Ups

- PDF page counting is heuristic and should be replaced with a PDF parser for production accuracy.
- Image printing through SumatraPDF may depend on installed support and command behavior; verify with the actual shop printer.
- Pricing config is seeded but not yet editable through admin UI.
- There is no automated UPI/payment reconciliation.
- No background scheduler is installed for cleanup; run `npm run cleanup` manually or via Windows Task Scheduler.
- App should be tested on mobile viewport and on the shop LAN with QR URL using the shop PC IP.
- Production secrets should be changed before real use.

## Resume Prompt

Continue work on the SelfPrint Xerox MVP in `C:\Users\Dev\OneDrive\Desktop\Selfprint`. The project is a Next.js TypeScript SQLite app with a separate Node.js Windows print agent. Preserve the decisions from this capsule: manual counter payment, SumatraPDF printing, DOC/DOCX store-only with needs-conversion status, local uploads, admin password/PIN, and no customer login. Start by running typecheck/build, fix any compile/runtime issues, then verify customer upload, admin payment/release, and agent polling flows end to end.
