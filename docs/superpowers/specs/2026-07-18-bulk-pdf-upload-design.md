# Bulk PDF Upload — Design

**Date:** 2026-07-18
**Status:** Approved (design)

## Goal

Let a customer upload **multiple PDFs at once** and get **one token, one combined
price, one payment**. All PDFs in a batch share the same print settings. Staff
release once; the agent prints every file. Also fix a separate defect: the print
agent never enables **collate**, so multi-copy jobs print uncollated.

## Scope / Decisions (locked)

- **Max 10 PDFs** per batch.
- **PDFs only** in bulk mode (single-file flow still handles JPG/PNG/DOC/DOCX).
- **Shared settings**: printType, copies, paperSize, layout, scale, margins,
  pagesPerSheet, duplex apply to the whole batch.
- **No page-range in bulk** — a range across N different PDFs is meaningless. Bulk
  prints all pages of every file. Single-file flow keeps its page-range selector.
- **Copies are per file**: copies=2 → 2 copies of each PDF.
- **One job = one card** in admin. One payment, one release, no batch-grouping
  layer. The multi-file-ness lives entirely inside `job_files`.
- **No DB migration.** `job_files` already permits many rows per `job_id`; today's
  code just never inserts more than one. Page counts come from the client
  (already computed per PDF) and are summed server-side into `jobs.page_count`.

## Non-goals

- Per-file settings (explicitly rejected in favor of shared settings).
- Mixed file kinds in one batch.
- Batch/parent-child job model. One job row represents the whole batch.

## Data model

Unchanged schema. Semantics change: a job may now own **1..10** `job_files` rows.

- `jobs.page_count` = Σ of each file's page count.
- `jobs.price_paise` = `calculatePrice({ pageCount: Σpages, ...sharedSettings })`.
  For shared settings this equals the sum of per-file prices. (Duplex odd-page
  rounding is approximated at the batch level rather than per file — acceptable;
  documented so nobody "fixes" it as a bug.)
- Each `job_files` row keeps its own `original_name`, `stored_name`,
  `storage_path`, `mime_type`, `size_bytes`, `file_kind='pdf'`, `created_at`.
- File print order = `job_files.created_at ASC` (insertion order = user's pick
  order).

## Components & changes

### 1. DB layer — `src/lib/db.ts` (SQLite) AND `src/lib/db-supabase.ts`

Both backends must change in lockstep (auto-selected at runtime).

- **New** `createJobWithFiles(jobData, fileData: FileData[])`: inserts one job +
  N `job_files` rows + the `created` print event, in a transaction (SQLite) /
  sequential inserts (Supabase). Keep existing `createJob` as a thin wrapper
  (`createJobWithFiles(job, [file])`) so nothing else breaks.
- **New** `getJobFilesByJob(jobId): JobFile[]` — returns all files ordered by
  `created_at ASC`.
- **Keep** `getJobFile(jobId)` returning the first file (back-compat for any
  caller not yet updated), but migrate callers below to the array form.
- `getJobsPage` already selects `job_files(*)` and maps `job_files[0]` to
  `job.file`. Extend the mapped `Job` with `fileCount` so the dashboard can show
  a "3 files" badge without a second query.

### 2. Upload API — `src/app/api/jobs/route.ts`

- Detect bulk by presence of `files[]` metadata (direct-upload path) — arrays of
  `storedName`, `originalName`, `mimeType`, `sizeBytes`, `pageCount`.
- Validate: count 1..10; every entry PDF (`validateUpload` → kind `pdf`); each
  size and Σ size within `MAX_UPLOAD_BYTES` (per-file cap unchanged; add a batch
  total guard).
- Reject bulk + page-range (ignore/omit page_range for bulk).
- `pageCount = Σ per-file counts`; `pricePaise = calculatePrice(...)`.
- Build `FileData[]`, call `createJobWithFiles`. Response unchanged shape
  (`{ token, pricePaise, pageCount, queuePosition, needsConversion:false }`).
- Single-file path unchanged (still `createJob` / one file).

### 3. Customer UI — `src/components/UploadForm.tsx`

- File input gains `multiple`. Selection of **2+ files** → bulk mode; **1 file** →
  existing single flow untouched.
- State: `files: File[]` + `uploads: Array<uploadPromise>` (generalize the
  existing single `uploadPromiseRef`/`startBackgroundUpload` to arrays; each file
  starts its own background signed-URL upload in parallel on selection).
- Validation on select: PDFs only in bulk; drop non-PDF with a message; enforce
  ≤10; DOC/DOCX still routes to the existing docx-warning.
- **Settings step**: same controls, **page-range selector hidden** in bulk.
- **Preview step (bulk)**: a scrollable **file list** — name, page count,
  size, remove (✕) button — plus totals (total pages, total price). No per-file
  PDF canvas render (10 PDFs on mobile is too heavy). Single-file preview keeps
  the existing `PdfCanvasPreview`.
- Removing a file aborts its in-flight upload and recomputes totals. If the list
  drops to 1 file, stay in bulk UI (simpler) but it's fine to fall back to single.
- Price estimate: `estimate` uses total page count across files.

### 4. Print agent — `agent/src/index.ts`

- Replace the single `job_files … .single()` fetch with fetch-**all** files for
  the job, ordered by `created_at ASC`.
- Loop files: download → (PDF) rasterize to PNGs via existing `renderPdfToPngs` →
  collect pages. **Print each file as its own GDI spool job** via
  `printImagesGDI` (so copies + collate apply per file: N collated sets per
  document). Page-range logic only runs when a single file has a range (bulk has
  none).
- Only mark the job `printed` after **all** files succeed. Any file failing goes
  through the existing retry loop; permanent failure → job `failed` with the
  file name in the message.
- Progress events: emit `downloaded`/`spooling` per file (include file index/name
  in the message) so the admin log shows per-file progress. Terminal `printed`
  once at the end.

### 5. Print helper — `agent/print-image.ps1` (collate fix)

- Add param `[string]$Collate = "true"`.
- After setting `Copies`: `$doc.PrinterSettings.Collate = ($Collate -eq "true")`.
- Default **on** → correct behavior `1,2,3 / 1,2,3` instead of `1,1,2,2,3,3`.
- Agent passes `-Collate "true"`. Applies to single-file jobs too (bug fix).

### 6. Admin — `JobDetail.tsx` + `src/app/api/admin/jobs/[id]/route.ts`

- **GET** `/api/admin/jobs/[id]`: return `files: JobFile[]` (keep `file` = first
  for back-compat).
- **DELETE**: loop `files` and `deleteFile(storagePath)` for each (not just one).
- `JobDetail`:
  - `Detail.files: JobFile[]`.
  - **FileCard** → list all files (name, size, kind), with a count header
    ("Files (3)").
  - **PreviewCard** → a file switcher (tabs or a dropdown) that previews the
    selected file via `/api/uploads/{fileId}` (route already serves by file id —
    unchanged).
  - **SummaryCard** shows "Pages" as the batch total (page-range row omitted /
    shown as "All" for bulk).
- **AdminDashboard** job card: show a small "N files" badge when `fileCount > 1`
  (uses `job.fileCount` from `getJobsPage`).

### 7. Housekeeping — already correct

- `/api/uploads/[id]` serves by `file.id` → works unchanged for any of N files.
- `cleanupOldJobs` and `bulkDeleteJobs` collect `job_files` by `job_id` (via
  `.in('job_id', ids)`) → already handle multiple files per job.
- `deleteJob` relies on FK cascade / row delete by job → multiple file rows go
  with it (verify cascade exists; if SQLite lacks `ON DELETE CASCADE`, delete
  `job_files` explicitly first — check in implementation).

## Data flow (bulk, happy path)

1. Customer selects 3 PDFs → 3 parallel signed-URL uploads to Supabase start.
2. Sets shared settings (color, 2 copies, A4, duplex…). No page range.
3. Preview shows 3-file list + total pages + total ₹. Confirms.
4. `POST /api/jobs` with 3 files' metadata → one job + 3 `job_files` → token.
5. Customer pays once (UPI/Razorpay/cash) against the single token.
6. Admin marks paid → releases → status `approved`.
7. Agent claims job, loops 3 files: download + rasterize + print (collated,
   2 copies each). Emits per-file events.
8. All done → job `printed`.

## Error handling

- Any file exceeds size cap, or batch total exceeds cap → 400 before job created.
- Non-PDF in bulk → rejected client-side and re-validated server-side.
- One file fails at print time → existing retry loop; permanent fail → job
  `failed`, message names the file. Staff can reprint (re-runs all files).
- Upload of one file fails in background → surfaced at Confirm, like today.

## Testing

- **Pricing**: batch of files with known page counts → job.page_count and
  price_paise equal the summed single-file computation (bw + color + duplex).
- **API**: bulk POST creates 1 job + N files; rejects >10, non-PDF, oversize.
- **Agent**: mock job with N files prints N spool jobs, marks printed once;
  a mid-batch failure marks failed and does not mark printed.
- **Collate**: `print-image.ps1` sets `PrinterSettings.Collate=true`; verify a
  2-copy 3-page job prints collated (manual/printer-driver check).
- **Admin**: JobDetail lists N files; preview switches between them; delete
  removes all N storage objects.
- Single-file flow regression: unchanged behavior end-to-end.

## Rollout notes

- No migration; deploy is code-only. Old single-file jobs keep working
  (`createJob` wrapper + `getJobFile` back-compat).
- Both `db.ts` and `db-supabase.ts` must ship together.
- Agent update must ship with the app (new multi-file fetch + collate param);
  an old agent against new jobs would print only the first file.
