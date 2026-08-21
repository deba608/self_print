# Per-PDF Customization in Bulk Mode — Plan

## Problem

Bulk upload (`isBulk` in `UploadForm.tsx`) lets a customer attach up to
`MAX_BULK_FILES` PDFs to one job, but **one settings object applies to every
file** — `printType`, `duplex`, `paperSize`, `copies`, `pagesPerSheet`. A
customer who wants file A in color and file B in B/W today has to split it
into two separate orders.

## Current architecture (confirmed by reading the code, not assumed)

- **DB**: `job_files` ([db.ts:101](../src/lib/db.ts)) stores only
  `name/mime/size/storage_path/kind` — no settings, not even a per-file page
  count.
- **Pricing**: [api/jobs/route.ts:503](../src/app/api/jobs/route.ts) sums
  `pageCount` across all files, then calls `calculatePrice()` **once**.
- **Agent**: `processJob()` in `agent/src/index.ts` already **loops per file**
  (`for (let idx = 0; idx < files.length; idx++)`) — good news, this isn't a
  rewrite. It just passes the same job-level `job` object into `printJob()`
  for every file, and `printJob`/`renderPdfToPngs`/`printImagesGDI` read
  straight off `job.print_type`, `job.duplex`, `job.paper_size`, etc.

So the fix is: store per-file overrides, merge them onto the job-level
defaults at three points (server pricing, agent printing, and — for the
live estimate — the client), and let the UI edit them.

## Scope for this pass

**In**: `printType`, `duplex`, `paperSize`, `copies`, `pagesPerSheet` — the
fields that actually change per document (a resume vs. a poster).

**Deferred**: `scale`, `margins`, `layout` per-file (rarely need to differ,
adds UI clutter for little value — inherit job-level). Per-file
spiral-binding/cover-file/bond-paper (physical assembly choices across the
*whole* stack, don't make sense per-document). Admin/customer detail views
showing a per-file settings breakdown (nice-to-have, not required for the
feature to work).

## Data model

`job_files.settings_json` — nullable TEXT. `NULL` = inherit the job's
settings (so every existing row and every non-customized file is untouched).
When set, JSON-encodes `{ printType?, duplex?, paperSize?, copies?,
pagesPerSheet? }` — a **partial** override, missing keys fall back to the
job-level value.

```sql
ALTER TABLE job_files ADD COLUMN settings_json TEXT;
```

SQLite: `ensureJobFileColumns`-style auto-migration in `db.ts`. Supabase:
new migration file, same pattern as `custom_note`.

## Pricing

Server ([api/jobs/route.ts](../src/app/api/jobs/route.ts)) and client
(`UploadForm.tsx`'s `priceBreakdown` memo) both currently do
`calculatePrice()` once for the summed page count. Change to: for each file,
build its **effective settings** (override ?? job-level), call
`calculatePrice()` for that one file's page count, sum the results. Identical
math when no file has an override — same price as today.

## API

`POST /api/jobs` (bulk branch): accept an optional `fileSettingsJson` field
— a JSON array, index-aligned with `files`, each entry `null` or a partial
override object. Validate each present field against the same enums as the
job-level fields (reuse `printTypes`/`paperSizes`/`duplexOptions`). Store on
each `job_files` insert.

## Client UI

In the bulk file thumbnail list ([UploadForm.tsx:1492](../src/components/pages/UploadForm.tsx)):
a "Customize" toggle per card, expanding a compact per-file panel (print
type / duplex / paper size / copies / pages-per-sheet) — reuses the existing
job-level control markup, not new components. State:
`bulkFileOverrides: (Partial<FileSettings> | null)[]`, index-aligned with
`bulkFiles`. Undo/reset-to-default per file.

## Agent

`processJob()`'s per-file loop already isolates each file's work. Add one
step: parse `file.settings_json`, merge onto the job object
(`{ ...job, ...overrides }`), pass that merged object to `printJob()` instead
of the raw `job`. No signature changes needed — every downstream function
(`printJob`, `renderPdfToPngs`, `printImagesGDI`, `paperName`,
`renderDpiFor`) already just reads fields off a job-shaped object.

## Implementation order

1. DB column (SQLite + Supabase migration) + `JobFile` type field.
2. Shared "effective settings" helper (`src/lib/pricing.ts` or new
   `src/lib/file-settings.ts`) — one function, used by both the API route
   and the client estimate so they can't drift.
3. API: accept + validate + store `fileSettingsJson`, sum per-file pricing.
4. Client: per-file override state + estimate calc using the shared helper.
5. UI: the per-file customize panel.
6. Agent: merge overrides before printing.

## Status

Implemented through step 6 in this pass. Admin/customer per-file settings
display in job-detail views (the one deferred "nice-to-have" from Scope) is
not done — the data is there (`job_files.settings_json`), just not
rendered anywhere outside the upload flow itself yet.
