# Bulk PDF Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer upload up to 10 PDFs at once and get one token, one combined price, one payment; agent prints all files. Fix the agent's missing collate setting.

**Architecture:** One `job` row owns 1..10 `job_files` rows (schema already allows it — no migration). All files in a batch share the job's print settings. `jobs.page_count` = Σ per-file pages; price = `calculatePrice(pageCount=Σ)`. Agent fetches all files and prints each as its own collated GDI spool job. Customer UI switches to a bulk flow when 2+ files are picked; single-file flow is untouched.

**Tech Stack:** Next.js 15, React 19, TypeScript, better-sqlite3 (local) / Supabase (prod), Node print agent, PowerShell GDI print helper. Tests: vitest (added in Task 1).

## Global Constraints

- Max **10** PDFs per bulk batch. Constant `MAX_BULK_FILES = 10`.
- Bulk accepts **PDF only** (`application/pdf`, `.pdf`). Single-file flow still accepts JPG/PNG/DOC/DOCX.
- Shared settings across the batch. **No page range in bulk** (`page_range = null`).
- Copies are **per file**.
- Per-file size ≤ `MAX_UPLOAD_BYTES` AND batch total ≤ `MAX_UPLOAD_BYTES * MAX_BULK_FILES`.
- No DB schema migration. Both `src/lib/db.ts` (SQLite) and `src/lib/db-supabase.ts` (Supabase) must change together.
- Money is integer paise. Never use floats for the stored price; `calculatePrice` already returns rounded paise.
- Follow existing code style: no semicolyn/format changes to untouched lines, match surrounding patterns.

---

### Task 1: Vitest setup + bulk validation module

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/bulk.ts`
- Create: `src/lib/bulk.test.ts`
- Modify: `package.json` (devDeps + `test` script)

**Interfaces:**
- Consumes: `validateUpload` from `src/lib/files.ts`, `MAX_UPLOAD_BYTES` from `src/lib/config.ts`.
- Produces:
  - `MAX_BULK_FILES = 10`
  - `type BulkFileMeta = { storedName: string; originalName: string; mimeType: string; sizeBytes: number; pageCount: number }`
  - `parseBulkFiles(raw: unknown): { files: BulkFileMeta[] } | { error: string }`
  - `sumPages(files: BulkFileMeta[]): number`

- [ ] **Step 1: Install vitest**

Run: `npm i -D vitest@^2`
Expected: adds `vitest` to devDependencies, no errors.

- [ ] **Step 2: Add test script to package.json**

In `package.json` `scripts`, add after `"typecheck"`:

```json
    "test": "vitest run",
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the failing test — `src/lib/bulk.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseBulkFiles, sumPages, MAX_BULK_FILES, type BulkFileMeta } from "./bulk";

function pdf(n: number, overrides: Partial<BulkFileMeta> = {}): BulkFileMeta {
  return {
    storedName: `s${n}.pdf`,
    originalName: `doc${n}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1000,
    pageCount: 2,
    ...overrides,
  };
}

function rawFrom(files: BulkFileMeta[]) {
  return files.map((f) => ({
    storedName: f.storedName,
    originalName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    pageCount: f.pageCount,
  }));
}

describe("parseBulkFiles", () => {
  it("accepts 1..10 valid PDFs", () => {
    const res = parseBulkFiles(rawFrom([pdf(1), pdf(2), pdf(3)]));
    expect("files" in res).toBe(true);
    if ("files" in res) {
      expect(res.files).toHaveLength(3);
      expect(res.files[0].pageCount).toBe(2);
    }
  });

  it("rejects more than MAX_BULK_FILES", () => {
    const many = Array.from({ length: MAX_BULK_FILES + 1 }, (_, i) => pdf(i));
    const res = parseBulkFiles(rawFrom(many));
    expect(res).toEqual({ error: expect.stringContaining("10") });
  });

  it("rejects empty list", () => {
    expect(parseBulkFiles([])).toHaveProperty("error");
  });

  it("rejects a non-PDF entry", () => {
    const res = parseBulkFiles(rawFrom([pdf(1), pdf(2, { originalName: "photo.jpg", mimeType: "image/jpeg" })]));
    expect(res).toHaveProperty("error");
  });

  it("rejects an oversized single file", () => {
    const res = parseBulkFiles(rawFrom([pdf(1, { sizeBytes: 999_999_999 })]));
    expect(res).toHaveProperty("error");
  });

  it("clamps pageCount to >= 1 and integer", () => {
    const res = parseBulkFiles(rawFrom([pdf(1, { pageCount: 0 })]));
    if ("files" in res) expect(res.files[0].pageCount).toBe(1);
    else throw new Error("expected files");
  });
});

describe("sumPages", () => {
  it("sums page counts", () => {
    expect(sumPages([pdf(1, { pageCount: 3 }), pdf(2, { pageCount: 5 })])).toBe(8);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- src/lib/bulk.test.ts`
Expected: FAIL — cannot resolve `./bulk`.

- [ ] **Step 6: Implement `src/lib/bulk.ts`**

```ts
import { MAX_UPLOAD_BYTES } from "./config";
import { validateUpload } from "./files";

export const MAX_BULK_FILES = 10;

export type BulkFileMeta = {
  storedName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
};

// Parses and validates the client-supplied file metadata for a bulk upload.
// Pure: no DB or network. Real bytes were already validated by the sign step;
// here we re-check type, count, and size so a forged request can't slip through.
export function parseBulkFiles(raw: unknown): { files: BulkFileMeta[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Invalid file list." };
  if (raw.length === 0) return { error: "Select at least one PDF." };
  if (raw.length > MAX_BULK_FILES) return { error: `You can upload at most ${MAX_BULK_FILES} files at once.` };

  const files: BulkFileMeta[] = [];
  let total = 0;
  for (const entry of raw) {
    const e = entry as Record<string, unknown>;
    const storedName = String(e.storedName ?? "");
    const originalName = String(e.originalName ?? "");
    const mimeType = String(e.mimeType ?? "");
    const sizeBytes = Math.max(1, Math.floor(Number(e.sizeBytes ?? 0)));
    const pageCount = Math.max(1, Math.min(1000, Math.floor(Number(e.pageCount ?? 1)) || 1));

    if (!storedName || !originalName) return { error: "Invalid upload metadata." };

    // PDF-only in bulk. validateUpload throws on non-PDF/JPG/PNG; then we also
    // require the resolved kind to be pdf.
    let kind: string;
    try {
      ({ kind } = validateUpload(originalName, mimeType));
    } catch {
      return { error: "Bulk upload accepts PDF files only." };
    }
    if (kind !== "pdf") return { error: "Bulk upload accepts PDF files only." };

    if (!Number.isFinite(sizeBytes) || sizeBytes > MAX_UPLOAD_BYTES) {
      return { error: `"${originalName}" is too large.` };
    }
    total += sizeBytes;
    files.push({ storedName, originalName, mimeType, sizeBytes, pageCount });
  }

  if (total > MAX_UPLOAD_BYTES * MAX_BULK_FILES) {
    return { error: "Total upload size is too large." };
  }
  return { files };
}

export function sumPages(files: BulkFileMeta[]): number {
  return files.reduce((sum, f) => sum + Math.max(1, f.pageCount), 0);
}
```

- [ ] **Step 7: Run tests to verify pass**

Run: `npm test -- src/lib/bulk.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json vitest.config.ts src/lib/bulk.ts src/lib/bulk.test.ts
git commit -m "feat: add vitest + bulk file validation module"
```

---

### Task 2: DB layer — createJobWithFiles + getJobFilesByJob (both backends)

**Files:**
- Modify: `src/lib/db.ts` (add two functions; refactor `createJob` to delegate)
- Modify: `src/lib/db-supabase.ts` (add two functions; refactor `createJob` to delegate)
- Create: `src/lib/db.bulk.test.ts` (SQLite-backed)

**Interfaces:**
- Consumes: existing `getDbInstance`, `mapJobFile`, `isSupabase` in `db.ts`; `mapJobFile`, `supabase` in `db-supabase.ts`.
- Produces (both modules, identical signatures):
  - `createJobWithFiles(jobData: any, filesData: any[]): Promise<{ jobId: string; fileIds: string[] }>`
  - `getJobFilesByJob(jobId: string): Promise<JobFile[]>` (ordered by `created_at ASC`, then `id`)
  - `createJob(jobData, fileData)` stays, now implemented as `createJobWithFiles(jobData, [fileData])` returning `{ jobId, fileId: fileIds[0] }`.

- [ ] **Step 1: Write the failing test — `src/lib/db.bulk.test.ts`**

This test forces SQLite (unset Supabase env) and uses a temp DB dir.

```ts
import { describe, it, expect, beforeAll } from "vitest";

// Force SQLite backend + isolated data dir BEFORE importing db.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.DATA_DIR = "./data-test-bulk";

describe("createJobWithFiles (sqlite)", () => {
  let db: typeof import("./db");
  beforeAll(async () => {
    db = await import("./db");
  });

  it("creates one job with three files, read back in order", async () => {
    const { jobId, fileIds } = await db.createJobWithFiles(
      {
        token: "111111",
        printType: "bw",
        copies: 2,
        pageRange: null,
        paperSize: "A4",
        layout: "portrait",
        pagesPerSheet: 1,
        margins: "default",
        scale: "default",
        duplex: "simplex",
        pageCount: 6,
        pricePaise: 3600,
        needsConversion: 0,
        queuePosition: 1,
      },
      [
        { originalName: "a.pdf", storedName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10, fileKind: "pdf", storagePath: "originals/a.pdf" },
        { originalName: "b.pdf", storedName: "b.pdf", mimeType: "application/pdf", sizeBytes: 20, fileKind: "pdf", storagePath: "originals/b.pdf" },
        { originalName: "c.pdf", storedName: "c.pdf", mimeType: "application/pdf", sizeBytes: 30, fileKind: "pdf", storagePath: "originals/c.pdf" },
      ]
    );
    expect(fileIds).toHaveLength(3);

    const files = await db.getJobFilesByJob(jobId);
    expect(files.map((f) => f.originalName)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("createJob still works for a single file", async () => {
    const { jobId, fileId } = await db.createJob(
      { token: "222222", printType: "bw", copies: 1, pageRange: null, paperSize: "A4", layout: "portrait", pagesPerSheet: 1, margins: "default", scale: "default", duplex: "simplex", pageCount: 1, pricePaise: 300, needsConversion: 0, queuePosition: 2 },
      { originalName: "solo.pdf", storedName: "solo.pdf", mimeType: "application/pdf", sizeBytes: 5, fileKind: "pdf", storagePath: "originals/solo.pdf" }
    );
    expect(fileId).toBeTruthy();
    const files = await db.getJobFilesByJob(jobId);
    expect(files).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Add the test dir to .gitignore**

Append to `.gitignore`:

```
data-test-bulk/
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/lib/db.bulk.test.ts`
Expected: FAIL — `db.createJobWithFiles is not a function`.

- [ ] **Step 4: Implement in `src/lib/db.ts`**

Replace the existing `createJob` (lines ~440-492) with a delegating wrapper and add the two new functions. Insert BEFORE the current `createJob`:

```ts
export async function createJobWithFiles(
  jobData: any,
  filesData: any[]
): Promise<{ jobId: string; fileIds: string[] }> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.createJobWithFiles(jobData, filesData);
  }

  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const fileIds = filesData.map(() => crypto.randomUUID());

  const j = {
    token: jobData.token,
    printType: jobData.printType ?? jobData.print_type,
    copies: jobData.copies,
    pageRange: jobData.pageRange ?? jobData.page_range ?? null,
    paperSize: jobData.paperSize ?? jobData.paper_size,
    layout: jobData.layout,
    pagesPerSheet: jobData.pagesPerSheet ?? jobData.pages_per_sheet,
    margins: jobData.margins,
    scale: jobData.scale,
    duplex: jobData.duplex ?? 'simplex',
    pageCount: jobData.pageCount ?? jobData.page_count,
    pricePaise: jobData.pricePaise ?? jobData.price_paise,
    needsConversion: jobData.needsConversion ?? jobData.needs_conversion,
    queuePosition: jobData.queuePosition ?? jobData.queue_position,
  };

  const firstKind = filesData[0]?.fileKind ?? filesData[0]?.file_kind;

  sqlite.transaction(() => {
    sqlite.prepare(`
      INSERT INTO jobs (id, token, status, print_type, copies, page_range, paper_size, layout, pages_per_sheet, margins, scale, duplex, page_count, price_paise, needs_conversion, queue_position, created_at, updated_at)
      VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, j.token, j.printType, j.copies, j.pageRange, j.paperSize, j.layout, j.pagesPerSheet, j.margins, j.scale, j.duplex, j.pageCount, j.pricePaise, j.needsConversion, j.queuePosition, now, now);

    const insertFile = sqlite.prepare(`
      INSERT INTO job_files (id, job_id, original_name, stored_name, mime_type, size_bytes, file_kind, storage_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    filesData.forEach((fd, i) => {
      insertFile.run(
        fileIds[i], jobId,
        fd.originalName ?? fd.original_name,
        fd.storedName ?? fd.stored_name,
        fd.mimeType ?? fd.mime_type,
        fd.sizeBytes ?? fd.size_bytes,
        fd.fileKind ?? fd.file_kind,
        fd.storagePath ?? fd.storage_path,
        now
      );
    });

    sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'created', ?, ?)")
      .run(crypto.randomUUID(), jobId, firstKind === 'document' ? 'Document upload needs conversion before printing.' : 'Customer submitted job.', now);
  })();

  return { jobId, fileIds };
}

export async function getJobFilesByJob(jobId: string): Promise<JobFile[]> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.getJobFilesByJob(jobId);
  }
  const sqlite = await getDbInstance();
  const rows = sqlite
    .prepare('SELECT * FROM job_files WHERE job_id = ? ORDER BY created_at ASC, id ASC')
    .all(jobId) as Record<string, unknown>[];
  return rows.map(mapJobFile);
}
```

Then replace the body of the existing `createJob` with a wrapper:

```ts
export async function createJob(jobData: any, fileData: any): Promise<{ jobId: string; fileId: string }> {
  const { jobId, fileIds } = await createJobWithFiles(jobData, [fileData]);
  return { jobId, fileId: fileIds[0] };
}
```

- [ ] **Step 5: Implement in `src/lib/db-supabase.ts`**

Add `createJobWithFiles` and `getJobFilesByJob`; make `createJob` delegate. Insert before the existing `createJob`:

```ts
export async function createJobWithFiles(jobData: any, filesData: any[]) {
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const fileIds = filesData.map(() => crypto.randomUUID());

  const normalizedJobData = {
    token: jobData.token,
    status: jobData.status ?? 'pending_payment',
    print_type: jobData.print_type ?? jobData.printType,
    copies: jobData.copies,
    page_range: jobData.page_range ?? jobData.pageRange ?? null,
    paper_size: jobData.paper_size ?? jobData.paperSize,
    layout: jobData.layout,
    pages_per_sheet: jobData.pages_per_sheet ?? jobData.pagesPerSheet,
    margins: jobData.margins,
    scale: jobData.scale,
    duplex: jobData.duplex ?? 'simplex',
    page_count: jobData.page_count ?? jobData.pageCount,
    price_paise: jobData.price_paise ?? jobData.pricePaise,
    needs_conversion: jobData.needs_conversion ?? jobData.needsConversion,
    queue_position: jobData.queue_position ?? jobData.queuePosition,
  };

  const { error: jobError } = await supabase
    .from('jobs')
    .insert([{ id: jobId, ...normalizedJobData, created_at: now, updated_at: now }]);
  if (jobError) throw jobError;

  const fileRows = filesData.map((fd, i) => ({
    id: fileIds[i],
    job_id: jobId,
    original_name: fd.original_name ?? fd.originalName,
    stored_name: fd.stored_name ?? fd.storedName,
    mime_type: fd.mime_type ?? fd.mimeType,
    size_bytes: fd.size_bytes ?? fd.sizeBytes,
    file_kind: fd.file_kind ?? fd.fileKind,
    storage_path: fd.storage_path ?? fd.storagePath,
    created_at: now,
  }));
  const { error: fileError } = await supabase.from('job_files').insert(fileRows);
  if (fileError) throw fileError;

  const firstKind = fileRows[0]?.file_kind;
  await supabase.from('print_events').insert([{
    id: crypto.randomUUID(),
    job_id: jobId,
    event_type: 'created',
    message: firstKind === 'document'
      ? 'Document upload needs conversion before printing.'
      : 'Customer submitted job.',
    created_at: now,
  }]);

  return { jobId, fileIds };
}

export async function getJobFilesByJob(jobId: string): Promise<JobFile[]> {
  const { data, error } = await supabase
    .from('job_files')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapJobFile);
}
```

Replace the existing `createJob` body with:

```ts
export async function createJob(jobData: any, fileData: any) {
  const { jobId, fileIds } = await createJobWithFiles(jobData, [fileData]);
  return { jobId, fileId: fileIds[0] };
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test -- src/lib/db.bulk.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db.ts src/lib/db-supabase.ts src/lib/db.bulk.test.ts .gitignore
git commit -m "feat: add createJobWithFiles + getJobFilesByJob to both DB backends"
```

---

### Task 3: Batch signed-upload endpoint

**Files:**
- Modify: `src/app/api/uploads/sign/route.ts`

**Interfaces:**
- Consumes: `createSignedUpload`, `cloudStorageEnabled` (storage.ts), `validateUpload` (files.ts), `MAX_UPLOAD_BYTES` (config.ts), `MAX_BULK_FILES` (bulk.ts).
- Produces: `POST /api/uploads/sign` also accepts `{ files: [{ fileName, mimeType, sizeBytes }] }` and returns `{ uploads: [{ signedUrl, token, objectPath, storedName, kind }] }`. Single-file body `{ fileName, mimeType, sizeBytes }` unchanged (still returns the flat object). One batch request counts as a single rate-limit hit.

- [ ] **Step 1: Modify the handler** (`src/app/api/uploads/sign/route.ts`)

After the rate-limit check and JSON parse, branch on `body.files`. Add the imports at top:

```ts
import { MAX_BULK_FILES } from "@/lib/bulk";
```

Replace the single-file body handling (from `const fileName = String(...)` to the final `try/catch` return) with:

```ts
  // Batch mode: { files: [{ fileName, mimeType, sizeBytes }, ...] }
  if (Array.isArray((body as any).files)) {
    const entries = (body as any).files as Array<{ fileName?: string; mimeType?: string; sizeBytes?: number }>;
    if (entries.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (entries.length > MAX_BULK_FILES) {
      return NextResponse.json({ error: `You can upload at most ${MAX_BULK_FILES} files at once.` }, { status: 400 });
    }

    const uploads: Array<{ signedUrl: string; token: string; objectPath: string; storedName: string; kind: string }> = [];
    for (const entry of entries) {
      const fileName = String(entry.fileName ?? "");
      const mimeType = String(entry.mimeType ?? "");
      const sizeBytes = Number(entry.sizeBytes ?? 0);
      if (!fileName || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return NextResponse.json({ error: "File name and size are required" }, { status: 400 });
      }
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: `"${fileName}" is too large` }, { status: 400 });
      }
      let ext: string, kind: string;
      try {
        ({ ext, kind } = validateUpload(fileName, mimeType));
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid file type" }, { status: 400 });
      }
      if (kind !== "pdf") {
        return NextResponse.json({ error: "Bulk upload accepts PDF files only." }, { status: 400 });
      }
      const storedName = `${crypto.randomUUID()}${ext}`;
      try {
        const { signedUrl, token, objectPath } = await createSignedUpload(kind, storedName);
        uploads.push({ signedUrl, token, objectPath, storedName, kind });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create upload URL" }, { status: 500 });
      }
    }
    return NextResponse.json({ uploads });
  }

  // Single-file mode (unchanged)
  const fileName = String(body.fileName ?? "");
  const mimeType = String(body.mimeType ?? "");
  const sizeBytes = Number(body.sizeBytes ?? 0);

  if (!fileName || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "File name and size are required" }, { status: 400 });
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is too large" }, { status: 400 });
  }

  let ext: string;
  let kind: string;
  try {
    ({ ext, kind } = validateUpload(fileName, mimeType));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid file type" },
      { status: 400 }
    );
  }

  const storedName = `${crypto.randomUUID()}${ext}`;

  try {
    const { signedUrl, token, objectPath } = await createSignedUpload(kind, storedName);
    return NextResponse.json({ signedUrl, token, objectPath, storedName, kind });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create upload URL" },
      { status: 500 }
    );
  }
```

Also update the `body` type annotation to allow `files`:

```ts
  let body: { fileName?: string; mimeType?: string; sizeBytes?: number; files?: unknown };
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/uploads/sign/route.ts
git commit -m "feat: batch mode for signed-upload endpoint (one rate-limit hit)"
```

---

### Task 4: Jobs API — bulk branch

**Files:**
- Modify: `src/app/api/jobs/route.ts`

**Interfaces:**
- Consumes: `parseBulkFiles`, `sumPages` (bulk.ts), `createJobWithFiles` (db.ts), `calculatePrice` (pricing.ts), `bucketPathFor` (storage.ts).
- Produces: `POST /api/jobs` accepts a bulk payload when `form.get("bulk") === "true"`: fields `filesJson` (a JSON string array of `{ storedName, originalName, mimeType, sizeBytes, pageCount }`). Creates one job + N files. Response shape unchanged: `{ jobId, token, pricePaise, needsConversion:false, pageCount, queuePosition }`.

- [ ] **Step 1: Add imports** at the top of `src/app/api/jobs/route.ts`:

```ts
import { parseBulkFiles, sumPages } from "@/lib/bulk";
import { createJob, createJobWithFiles, getPricing, nextQueuePosition, sseClients } from "@/lib/db";
```

(Replace the existing `createJob`-only import line with the line above.)

- [ ] **Step 2: Add the bulk branch** near the top of `POST`, immediately after `const form = await request.formData();`:

```ts
    if (form.get("bulk") === "true") {
      return await handleBulk(form);
    }
```

- [ ] **Step 3: Add the `handleBulk` function** at the bottom of the file (after `POST`, before `randomToken`):

```ts
async function handleBulk(form: FormData): Promise<NextResponse> {
  // Shared settings (page range intentionally omitted for bulk).
  const printType = String(form.get("printType") ?? "bw") as PrintType;
  const copies = Math.max(1, Math.floor(Number(form.get("copies") ?? 1)));
  if (isNaN(copies) || copies < 1 || copies > 99) {
    return NextResponse.json({ error: "Copies must be between 1 and 99" }, { status: 400 });
  }
  const paperSize = String(form.get("paperSize") ?? "A4") as PaperSize;
  const layout = String(form.get("layout") ?? "portrait") as PrintLayout;
  const pagesPerSheet = Math.max(1, Math.min(4, Math.floor(Number(form.get("pagesPerSheet") ?? 1)) || 1));
  const margins = String(form.get("margins") ?? "default") as PrintMargins;
  const scale = String(form.get("scale") ?? "default") as PrintScale;
  const duplex = String(form.get("duplex") ?? "simplex") as PrintDuplex;
  if (
    !printTypes.includes(printType) ||
    !paperSizes.includes(paperSize) ||
    !layouts.includes(layout) ||
    !scaleOptions.includes(scale) ||
    !marginsOptions.includes(margins) ||
    !duplexOptions.includes(duplex)
  ) {
    return NextResponse.json({ error: "Invalid print settings" }, { status: 400 });
  }

  let rawFiles: unknown;
  try {
    rawFiles = JSON.parse(String(form.get("filesJson") ?? "[]"));
  } catch {
    return NextResponse.json({ error: "Invalid file list." }, { status: 400 });
  }
  const parsed = parseBulkFiles(rawFiles);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const files = parsed.files;

  const pageCount = sumPages(files);
  const pricing = await getPricing();
  // Bulk has no page range; duplex needs 2+ pages across the whole batch.
  if (duplex !== "simplex" && pageCount < 2) {
    return NextResponse.json({ error: "Double-sided printing requires at least 2 pages." }, { status: 400 });
  }
  const pricePaise = calculatePrice({ printType, copies, pageRange: null, paperSize, pageCount: Math.max(pageCount, 1), pricing, duplex });
  const token = randomToken();
  const queuePos = await nextQueuePosition();

  const jobData = {
    token,
    print_type: printType,
    copies,
    page_range: null,
    paper_size: paperSize,
    layout,
    pages_per_sheet: pagesPerSheet,
    margins,
    scale,
    duplex,
    page_count: pageCount,
    price_paise: pricePaise,
    needs_conversion: 0,
    queue_position: queuePos,
  };

  const filesData = files.map((f) => ({
    original_name: f.originalName,
    stored_name: f.storedName,
    mime_type: f.mimeType || "application/pdf",
    size_bytes: f.sizeBytes,
    file_kind: "pdf",
    storage_path: bucketPathFor("pdf", f.storedName),
  }));

  const { jobId } = await createJobWithFiles(jobData, filesData);
  broadcast({ type: "new_job", jobId, token, queuePosition: queuePos });

  return NextResponse.json({ jobId, token, pricePaise, needsConversion: false, pageCount, queuePosition: queuePos });
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Runtime verify (manual, requires cloud storage env)**

Only if `SUPABASE_URL`/key are set locally: start dev server (`preview_start` name "dev") and POST a bulk form via the UI in Task 5. Otherwise verification happens end-to-end in Task 5. Note this in the commit.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/jobs/route.ts
git commit -m "feat: bulk branch in POST /api/jobs (one job, many files)"
```

---

### Task 5: Customer UI — bulk upload flow

**Files:**
- Modify: `src/components/UploadForm.tsx`

**Interfaces:**
- Consumes: `POST /api/uploads/sign` batch mode, `POST /api/jobs` bulk payload.
- Produces: UI behavior only. When 2+ files are selected, the form enters bulk mode: multi-file input, N parallel background uploads, shared-settings step with **no page-range selector**, a file-list preview, and a single confirm that submits the bulk payload.

**Design notes for the implementer:**
- Add `multiple` to the file input (line ~709). Keep the single-file path exactly as-is when exactly one file is chosen.
- New state: `bulkFiles: File[]`, `bulkUploads: Array<Promise<{ storedName?: string; error?: string }>>`, `bulkPageCounts: number[]`, `isBulk: boolean` (derived: `bulkFiles.length > 1`).
- On selection in `handleFileChange`: if `files.length > 1`, validate each is PDF (`type === "application/pdf"`); reject the batch with an error if any isn't; cap at `10` (slice + warn). Compute each file's page count with the existing `estimatePdfPages`. Kick off one batch sign request is NOT used here — instead call `startBulkUploads(files)` which does a **single** `POST /api/uploads/sign` with `{ files: [...] }`, then `uploadToSignedUrl` for each returned upload in parallel (mirrors `startBackgroundUpload` but for the array). Store the promise array.
- Settings step: render the SAME controls, but wrap the "Select Pages" `form-group` (lines ~833-895) in `{!isBulk && ( ... )}` so it's hidden in bulk.
- Preview step: when `isBulk`, replace `PdfCanvasPreview`/image preview with a scrollable list:

```tsx
<div className="bulk-file-list">
  {bulkFiles.map((f, i) => (
    <div className="bulk-file-row" key={i}>
      <FileText size={18} aria-hidden="true" />
      <span className="bulk-file-name">{f.name}</span>
      <span className="bulk-file-pages">{bulkPageCounts[i] ?? 1} pg</span>
      <button type="button" className="bulk-file-remove" aria-label={`Remove ${f.name}`}
        onClick={() => removeBulkFile(i)}>
        <X size={16} />
      </button>
    </div>
  ))}
</div>
```

- `removeBulkFile(i)`: abort that upload if possible, splice `bulkFiles`/`bulkPageCounts`/`bulkUploads`. If the list falls to 1, keep bulk UI (acceptable) — do not silently switch flows mid-edit.
- Price estimate for bulk: use total pages = `bulkPageCounts.reduce((a,b)=>a+(b||1),0)` in the existing `estimate` memo (add a branch: when `isBulk`, use the summed count in place of `selectedPages`).
- `handleSubmit` bulk branch: await all `bulkUploads`; if any `.error`, show it and stop. Build the payload:

```ts
const bulkForm = new FormData();
bulkForm.set("bulk", "true");
bulkForm.set("printType", printType);
bulkForm.set("copies", String(copies));
bulkForm.set("paperSize", paperSize);
bulkForm.set("layout", layout);
bulkForm.set("scale", scale);
bulkForm.set("margins", margins);
bulkForm.set("pagesPerSheet", String(pagesPerSheet));
bulkForm.set("duplex", duplex);
bulkForm.set("filesJson", JSON.stringify(
  bulkFiles.map((f, i) => ({
    storedName: uploadedStoredNames[i],
    originalName: f.name,
    mimeType: f.type || "application/pdf",
    sizeBytes: f.size,
    pageCount: bulkPageCounts[i] ?? 1,
  }))
));
const response = await fetch("/api/jobs", { method: "POST", body: bulkForm, signal: controller.signal });
```

where `uploadedStoredNames[i]` comes from each resolved upload's `storedName`.
- `resetForm` must also clear the bulk state and abort in-flight bulk uploads.
- Add minimal CSS for `.bulk-file-list`, `.bulk-file-row`, `.bulk-file-name`, `.bulk-file-pages`, `.bulk-file-remove` in the same stylesheet used by the form (find where `.upload-zone` is styled and colocate).

- [ ] **Step 1: Implement the bulk state + selection handling** per the design notes above.

- [ ] **Step 2: Implement `startBulkUploads`** (single batch sign + parallel uploads), mirroring `startBackgroundUpload`:

```ts
async function startBulkUploads(selected: File[]): Promise<Array<{ storedName?: string; error?: string }>> {
  if (!supabaseClient) return selected.map(() => ({ error: "Direct upload unavailable" }));
  try {
    const signRes = await fetch("/api/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: selected.map((f) => ({ fileName: f.name, mimeType: f.type, sizeBytes: f.size })) }),
    });
    const signBody = await signRes.json().catch(() => ({}));
    if (!signRes.ok) throw new Error(signBody.error ?? "Could not start upload.");
    const uploads = signBody.uploads as Array<{ objectPath: string; token: string; storedName: string }>;
    return await Promise.all(selected.map(async (file, i) => {
      const u = uploads[i];
      const { error } = await supabaseClient!.storage
        .from("selfprint")
        .uploadToSignedUrl(u.objectPath, u.token, file, { contentType: file.type || "application/pdf" });
      if (error) return { error: `Upload failed for ${file.name}: ${error.message}` };
      return { storedName: u.storedName };
    }));
  } catch (err) {
    return selected.map(() => ({ error: err instanceof Error ? err.message : "Upload failed" }));
  }
}
```

- [ ] **Step 3: Wire settings/preview/submit** per design notes (hide page-range in bulk, file-list preview, bulk submit payload, reset).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Runtime verify in the browser**

Requires `SUPABASE_URL` + key in `.env` (direct upload path). Then:
1. `preview_start` with `{ name: "dev" }` (add a `.claude/launch.json` "dev" running `npm run dev` on port 3000 if absent).
2. Navigate to `/`. Select two small PDFs.
3. Confirm the flow reaches the settings step with NO "Select Pages" control.
4. Confirm preview shows both file names + page counts + total price.
5. Confirm submit yields one token screen.
6. `read_console_messages` — no errors. `read_network_requests` — one `/api/uploads/sign` call (not two) and one `/api/jobs` call.
7. `computer` screenshot of the token screen as proof.

If no Supabase env locally: skip runtime, note it, rely on Task 8's admin check after a real upload.

- [ ] **Step 6: Commit**

```bash
git add src/components/UploadForm.tsx
git commit -m "feat: bulk PDF upload flow in customer UI"
```

---

### Task 6: Print agent — multi-file printing

**Files:**
- Modify: `agent/src/index.ts`

**Interfaces:**
- Consumes: existing `renderPdfToPngs`, `printImagesGDI`, `updateStatus`, `logEvent`, `claimJob`.
- Produces: `processJob` downloads and prints ALL `job_files` rows (ordered), marking `printed` only after every file succeeds.

**Design notes:**
- In `processJob`, replace the single-file fetch (`.from("job_files")…single()`, lines ~247-257) with:

```ts
const { data: files, error: fileError } = await supabase
  .from("job_files")
  .select("*")
  .eq("job_id", jobId)
  .order("created_at", { ascending: true })
  .order("id", { ascending: true }) as { data: SupabaseJobFile[] | null; error: { message: string } | null };

if (fileError || !files || files.length === 0) {
  await updateStatus(jobId, "failed", "No file found for this job.");
  log(`No files found for job ${jobId}`);
  return;
}
```

- After `claimJob`, replace the single-file download+print block (the `while (attempt...)` loop currently wraps one file) with a loop over `files`. Keep the per-attempt retry for the WHOLE batch: on any file failure, throw to trigger the existing retry; on success of all, mark printed once. Structure:

```ts
let attempt = 0;
while (attempt < config.maxRetries) {
  attempt++;
  const tempPaths: string[] = [];
  try {
    for (let idx = 0; idx < files.length; idx++) {
      const file = files[idx];
      const extension = extensionFor(file.mime_type, file.original_name);
      const tempPath = path.resolve(config.tempDir, `${job.token}-${idx}-${safeFileName(file.original_name, extension)}`);
      tempPaths.push(tempPath);

      log(`Downloading file ${idx + 1}/${files.length} (attempt ${attempt}/${config.maxRetries})...`);
      const fileBytes = await downloadJobFile(file);   // extract existing download logic into this helper
      await fs.writeFile(tempPath, fileBytes);
      await logEvent(jobId, "downloaded", `Downloaded ${file.original_name} (${(fileBytes.length / 1024).toFixed(0)} KB), file ${idx + 1}/${files.length}.`);

      const printer = cachedPrinterName || config.fallbackPrinter;
      if (!printer) throw new Error("No printer selected. Set a printer in admin dashboard.");

      await logEvent(jobId, "spooling", `Printing ${file.original_name} (${idx + 1}/${files.length}) on ${printer}.`);
      const PRINT_TIMEOUT_MS = 5 * 60 * 1000;
      await Promise.race([
        printJob(tempPath, job, printer),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Print job timed out after 5 minutes")), PRINT_TIMEOUT_MS)),
      ]);
    }

    await updateStatus(jobId, "printed", `Printed ${files.length} file(s) on attempt ${attempt}.`);
    log(`Job ${job.token} completed successfully (${files.length} file(s)).`);
    break;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Attempt ${attempt} failed: ${errorMsg}`);
    if (attempt >= config.maxRetries) {
      await updateStatus(jobId, "failed", `Failed after ${config.maxRetries} attempts: ${errorMsg}`);
      log(`Job ${job.token} failed permanently.`);
    } else {
      await updateStatus(jobId, "printing", `Retry ${attempt}/${config.maxRetries} after error: ${errorMsg}`);
      await sleep(2000);
    }
  } finally {
    for (const p of tempPaths) await fs.rm(p, { force: true }).catch(() => undefined);
  }
}
```

- Extract the existing file-download logic (the `objectPath`/`supabase.storage.download`/fetch fallback block, lines ~298-328) into a helper `async function downloadJobFile(file: SupabaseJobFile): Promise<Buffer>` and reuse it. Keep the size-mismatch warning inside it.
- Leave the `targetPrinter` installed-check (lines ~263-274) as-is (runs once before the loop).

- [ ] **Step 1: Extract `downloadJobFile` helper** from the current inline download logic.

- [ ] **Step 2: Replace single-file fetch with multi-file fetch + print loop** per design notes.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (agent is included in tsconfig; if not, run `npx tsc --noEmit -p .` and confirm `agent/src/index.ts` compiles).

- [ ] **Step 4: Runtime verify (manual)**

With a configured `agent/config.json` + a printer (or `Microsoft Print to PDF`):
1. Create a bulk job via the UI (Task 5) and release it in admin.
2. `npm run agent`; watch `agent/agent.log`.
3. Confirm log shows "Downloading file 1/2", "2/2", "Printed 2 file(s)".
4. Confirm two outputs at the printer (or two PDFs for Print-to-PDF).

- [ ] **Step 5: Commit**

```bash
git add agent/src/index.ts
git commit -m "feat: agent prints all files in a multi-file job"
```

---

### Task 7: Collate fix in print helper

**Files:**
- Modify: `agent/print-image.ps1`
- Modify: `agent/src/index.ts` (pass `-Collate`)

**Interfaces:**
- Produces: `print-image.ps1` accepts `-Collate` ("true"|"false", default "true") and sets `$doc.PrinterSettings.Collate`. Agent passes `-Collate "true"`.

- [ ] **Step 1: Add the param** to `agent/print-image.ps1` param block (after `-Duplex`):

```powershell
  [string]$Duplex = "simplex",        # simplex | long-edge | short-edge
  [string]$Collate = "true"           # true | false — collate multi-copy output
```

- [ ] **Step 2: Set Collate** right after the `Copies` assignment (after line ~25 `$doc.PrinterSettings.Copies = [int16]$Copies`):

```powershell
$doc.PrinterSettings.Collate = ($Collate -eq "true")
```

- [ ] **Step 3: Pass `-Collate` from the agent** in `printImagesGDI` (`agent/src/index.ts`), add to the `args` array after the `-Duplex` entry:

```ts
          "-Duplex", job.duplex || "simplex",
          "-Collate", "true"
```

- [ ] **Step 4: Runtime verify (manual, printer-driver dependent)**

Print a 3-page PDF with copies=2 to a real printer. Confirm page order is 1,2,3,1,2,3 (collated), not 1,1,2,2,3,3. (Microsoft Print to PDF merges to one file and won't demonstrate collation — use a physical printer or a driver that shows it.)

- [ ] **Step 5: Commit**

```bash
git add agent/print-image.ps1 agent/src/index.ts
git commit -m "fix: enable collate in GDI print helper (default on)"
```

---

### Task 8: Admin — show all files

**Files:**
- Modify: `src/app/api/admin/jobs/[id]/route.ts`
- Modify: `src/components/JobDetail.tsx`
- Modify: `src/lib/db.ts` and `src/lib/db-supabase.ts` (add `fileCount` to `getJobsPage` mapping)
- Modify: `src/components/AdminDashboard.tsx` (badge)

**Interfaces:**
- Consumes: `getJobFilesByJob` (db.ts).
- Produces: admin GET returns `files: JobFile[]` (plus `file` = `files[0]` for back-compat); JobDetail renders all files with a preview switcher; DELETE removes all files' storage objects; dashboard shows an "N files" badge when a job has more than one file.

- [ ] **Step 1: Admin GET returns files[]** — in `src/app/api/admin/jobs/[id]/route.ts` GET, replace `const file = await getJobFile(id);`:

```ts
    const { getJobFilesByJob } = await import("@/lib/db");
    const files = await getJobFilesByJob(id);
    const file = files[0] ?? null;
    const events = await getJobEvents(id);
    return NextResponse.json({ job, file, files, events });
```

- [ ] **Step 2: Admin DELETE removes all files** — replace the single `getJobFile` block in DELETE:

```ts
  try {
    const { getJobFilesByJob } = await import("@/lib/db");
    const files = await getJobFilesByJob(id);
    for (const f of files) {
      if (f.storagePath) await deleteFile(f.storagePath).catch(() => undefined);
    }
  } catch {
    // Ignore file deletion errors
  }
```

- [ ] **Step 3: JobDetail renders files[]** — in `src/components/JobDetail.tsx`:
  - Extend `Detail` type: add `files: Array<{ id: string; originalName: string; mimeType: string; fileKind: string; sizeBytes: number }>`.
  - In the component body, derive `const files = detail.files ?? (detail.file ? [detail.file] : []);`.
  - `FileCard`: accept `files` and render a titled list ("Files (3)") with each name/size/kind. For a single file, keep current look.
  - `PreviewCard`: accept `files`; add local state `selectedFileId` defaulting to `files[0]?.id`; render a row of small buttons (one per file, label = index or truncated name) that switch the preview; `previewUrl = \`/api/uploads/${selectedFileId}\``. For a single file, hide the switcher.
  - `SummaryCard`: unchanged except the "Pages" row already shows the job total; when `files.length > 1` change the "Pages" label value to `\`${job.pageCount} pages, ${files.length} files\``.

- [ ] **Step 4: `getJobsPage` exposes fileCount** — in both `db.ts` and `db-supabase.ts`, set `job.fileCount`:
  - `db-supabase.ts` `getJobsPage`: after `job.file = ...`, add `job.fileCount = Array.isArray(row.job_files) ? row.job_files.length : (job.file ? 1 : 0);`
  - `db.ts` `getJobsPage`: the LEFT JOIN returns one row per file, collapsing is needed. Simplest: add a subquery column. Change the SELECT to include `(SELECT COUNT(*) FROM job_files jf WHERE jf.job_id = jobs.id) AS f_count` and set `job.fileCount = Number(row.f_count ?? (row.f_id ? 1 : 0));`. Note: the existing LEFT JOIN duplicates job rows when a job has multiple files — add `GROUP BY jobs.id` to both SELECT statements to collapse (SQLite returns the first matched file per group, which is fine for the card thumbnail).
  - Add `fileCount?: number` to the `Job` type in `src/lib/types.ts`.

- [ ] **Step 5: Dashboard badge** — in `src/components/AdminDashboard.tsx`, where a job card renders the file name, add when `job.fileCount && job.fileCount > 1`: a small badge `\`${job.fileCount} files\``. (Find the job-card file display and colocate; match existing badge styling.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Runtime verify in the browser**

1. With a bulk job present, open `/admin` — confirm the card shows an "N files" badge.
2. Open the job detail — confirm the Files card lists all files and the Preview switcher cycles through each PDF.
3. Confirm single-file jobs look unchanged.
4. `read_console_messages` — no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/admin/jobs/[id]/route.ts src/components/JobDetail.tsx src/components/AdminDashboard.tsx src/lib/db.ts src/lib/db-supabase.ts src/lib/types.ts
git commit -m "feat: admin shows all files for multi-file jobs"
```

---

### Task 9: Full regression pass + final verify

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Single-file regression (browser)**

Upload ONE PDF and ONE image via `/`. Confirm the page-range selector is present, preview renders via canvas/image, submit yields a token, admin shows the single file. No console errors.

- [ ] **Step 4: Bulk end-to-end (browser + agent)**

Upload 3 PDFs → one token → mark paid → release → agent prints 3 files (collated) → job `printed`. Confirm `agent/agent.log` shows per-file progress.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test: bulk upload regression pass"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 2), upload API (Task 4), sign rate-limit gap (Task 3, not in spec but required), customer UI (Task 5), agent (Task 6), collate (Task 7), admin GET/DELETE/JobDetail/dashboard (Task 8), housekeeping already-correct (no task needed — verified in spec §7), testing (Tasks 1-2 units + runtime verifies).
- **Duplex pricing approximation:** batch-level odd-page rounding, as documented in the spec — intentional, not a bug.
- **Cascade delete:** Task 8 DELETE explicitly deletes each file's storage object; row deletion relies on existing job delete (verify `ON DELETE CASCADE` on `job_files.job_id` during Task 2 — if absent in `db.ts` schema, the SQLite delete of a job will orphan `job_files` rows; add an explicit `DELETE FROM job_files WHERE job_id = ?` to `deleteJob` if needed).
- **Back-compat:** `createJob` and `getJobFile` retained as wrappers so untouched callers keep working.
