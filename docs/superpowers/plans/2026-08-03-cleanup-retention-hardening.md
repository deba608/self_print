# Cleanup & Retention Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple cleanup/retention config from customer-facing pricing config, make hardcoded cleanup windows configurable, batch large deletes, add cleanup audit logging, and add explicit retention for login-event history — while preserving the existing (already-correct) behavior of keeping job rows + file metadata (`original_name`) forever and only clearing `storage_path` bytes after `FILE_RETENTION_DAYS` (default 3).

**Architecture:** All changes live in `src/lib/config.ts` (new env-driven constants), `src/lib/db.ts` / `src/lib/db-supabase.ts` (cleanup logic, both DB backends kept in sync), and `src/app/api/cleanup/route.ts` (wiring stray-file window + audit log call). A new `print_events`-style table `cleanup_events` (Supabase) / SQLite table logs each cleanup run's counts. No schema change to `jobs`/`job_files` — current purge-by-clearing-`storage_path` design already satisfies "keep order history + filenames forever, delete files after 3 days."

**Tech Stack:** TypeScript, better-sqlite3, @supabase/supabase-js, vitest.

## Global Constraints

- Do not change `FILE_RETENTION_DAYS` default (3 days) or its meaning — file bytes only, metadata kept forever. This is already correct in both `db.ts` and `db-supabase.ts`.
- Do not touch customer-facing `pricing.expiryMinutes` (token/job expiry shown to customers) — only stop reusing it as the abandoned-cart cleanup cutoff.
- All new env vars must have safe defaults so `npm run cleanup` / `/api/cleanup` keep working with zero config changes.
- Keep SQLite (`db.ts`) and Supabase (`db-supabase.ts`) implementations behaviorally identical — every task touches both files.
- No new external dependencies.

---

### Task 1: Decouple abandoned-cart cutoff from customer-facing expiry

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/lib/db.ts:1078` (`cleanupOldJobs`, SQLite path — check exact line via `grep cleanupOldJobs src/lib/db.ts`)
- Modify: `src/lib/db-supabase.ts:806-878` (`cleanupOldJobs`)
- Test: `src/lib/config.test.ts` (new file)

**Interfaces:**
- Produces: `CART_ABANDON_MINUTES` exported number constant from `config.ts`, used by both `cleanupOldJobs` implementations in place of `pricing.expiryMinutes`.

- [ ] **Step 1: Write failing test for the new constant**

```typescript
// src/lib/config.test.ts
import { describe, it, expect } from "vitest";
import { CART_ABANDON_MINUTES } from "./config";

describe("CART_ABANDON_MINUTES", () => {
  it("defaults to 1440 minutes (24h) when env var unset", () => {
    expect(CART_ABANDON_MINUTES).toBe(1440);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/config.test.ts`
Expected: FAIL — `CART_ABANDON_MINUTES` is not exported.

- [ ] **Step 3: Add the constant to config.ts**

In `src/lib/config.ts`, directly below `DEFAULT_EXPIRY_MINUTES`:

```typescript
// Cleanup-only: how long an unpaid "pending_payment" cart can sit before its
// row + files are deleted outright. Deliberately separate from the
// customer-facing job/token expiry (DEFAULT_EXPIRY_MINUTES / pricing.expiryMinutes)
// so changing what customers see never silently changes retention behavior.
export const CART_ABANDON_MINUTES = Number(process.env.CART_ABANDON_MINUTES ?? 1440);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/config.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into db-supabase.ts**

In `src/lib/db-supabase.ts`, change the import line (currently line 4):

```typescript
import { FILE_RETENTION_DAYS } from './config';
```

to:

```typescript
import { FILE_RETENTION_DAYS, CART_ABANDON_MINUTES } from './config';
```

Then in `cleanupOldJobs` (around line 806-808), replace:

```typescript
  const pricing = await getPricing();
  const abandonedCutoff = new Date(Date.now() - pricing.expiryMinutes * 60000).toISOString();
```

with:

```typescript
  const abandonedCutoff = new Date(Date.now() - CART_ABANDON_MINUTES * 60000).toISOString();
```

Remove the `getPricing()` call entirely if `pricing` is not used elsewhere in the function (check remaining body first — it is not, per the read function).

- [ ] **Step 6: Wire into db.ts (SQLite)**

Open `src/lib/db.ts`, find the SQLite `cleanupOldJobs` implementation (search `function cleanupOldJobs` near the Supabase-delegate wrapper at line 1078 — the SQLite body lives further down in the same file, look for `abandonedCutoff` or `pricing.expiryMinutes` usage). Apply the identical replacement: import `CART_ABANDON_MINUTES` from `./config`, use it instead of `pricing.expiryMinutes` for the abandoned-cart cutoff. Leave `FILE_RETENTION_DAYS` usage untouched.

- [ ] **Step 7: Run full test suite**

Run: `npm run test`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/lib/config.ts src/lib/config.test.ts src/lib/db.ts src/lib/db-supabase.ts
git commit -m "refactor: decouple cart abandonment cutoff from customer-facing job expiry"
```

---

### Task 2: Make stray-file sweep window configurable

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/app/api/cleanup/route.ts:31-34`

**Interfaces:**
- Produces: `STRAY_FILE_RETENTION_HOURS` exported number constant from `config.ts`.

- [ ] **Step 1: Add constant to config.ts**

```typescript
// How long an uploaded file can sit without a matching job_files row before
// the cleanup sweep deletes it as orphaned (e.g. upload succeeded but job
// creation failed). Separate from CART_ABANDON_MINUTES because it targets
// filesystem/storage orphans, not database rows.
export const STRAY_FILE_RETENTION_HOURS = Number(process.env.STRAY_FILE_RETENTION_HOURS ?? 2);
```

- [ ] **Step 2: Use it in the cleanup route**

In `src/app/api/cleanup/route.ts`, add the import:

```typescript
import { STRAY_FILE_RETENTION_HOURS } from "@/lib/config";
```

Replace lines 31-33:

```typescript
  // Clean up stray files older than 2 hours
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const oldOriginals = await listOldFiles('originals', twoHoursMs);
  const oldConverted = await listOldFiles('converted', twoHoursMs);
```

with:

```typescript
  // Clean up stray files older than STRAY_FILE_RETENTION_HOURS
  const strayWindowMs = STRAY_FILE_RETENTION_HOURS * 60 * 60 * 1000;
  const oldOriginals = await listOldFiles('originals', strayWindowMs);
  const oldConverted = await listOldFiles('converted', strayWindowMs);
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/config.ts src/app/api/cleanup/route.ts
git commit -m "feat: make stray-file sweep window configurable via STRAY_FILE_RETENTION_HOURS"
```

---

### Task 3: Batch large deletes/updates to avoid oversized IN() queries

**Files:**
- Modify: `src/lib/db-supabase.ts` (abandoned-cart delete block, lines ~832-842; finished-job purge block, lines ~857-874)
- Modify: `src/lib/db.ts` (SQLite equivalent — SQLite `IN` with `?` placeholders has a 999-parameter default limit, so this matters there too)
- Test: `src/lib/db.test.ts` or existing test file covering `cleanupOldJobs` (check for one first with `grep -r cleanupOldJobs src/lib/*.test.ts`; create `src/lib/cleanup-batch.test.ts` if none exists)

**Interfaces:**
- Produces: local helper `chunk<T>(arr: T[], size: number): T[][]` — add once in `src/lib/db-supabase.ts` (or a shared `src/lib/util.ts` if you prefer, since both `db.ts` and `db-supabase.ts` need it) and import into both.

- [ ] **Step 1: Write failing test for the chunk helper**

Create `src/lib/util.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { chunk } from "./util";

describe("chunk", () => {
  it("splits an array into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 2)).toEqual([]);
  });

  it("returns one chunk when size exceeds array length", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/util.test.ts`
Expected: FAIL — module `./util` does not exist.

- [ ] **Step 3: Create src/lib/util.ts**

```typescript
export function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/lib/util.test.ts`
Expected: PASS

- [ ] **Step 5: Use chunk() in db-supabase.ts abandoned-cart delete**

In `src/lib/db-supabase.ts`, add import:

```typescript
import { chunk } from './util';
```

Replace the abandoned-delete block (lines ~832-842):

```typescript
  if (abandonedIds.length > 0) {
    const { data: files, error: fileErr } = await supabase
      .from('job_files')
      .select('storage_path')
      .in('job_id', abandonedIds);
    if (fileErr) throw fileErr;
    storagePaths.push(...(files || []).map((f) => String(f.storage_path)));

    const { error: delErr } = await supabase.from('jobs').delete().in('id', abandonedIds);
    if (delErr) throw delErr;
  }
```

with:

```typescript
  for (const idBatch of chunk(abandonedIds, 200)) {
    const { data: files, error: fileErr } = await supabase
      .from('job_files')
      .select('storage_path')
      .in('job_id', idBatch);
    if (fileErr) throw fileErr;
    storagePaths.push(...(files || []).map((f) => String(f.storage_path)));

    const { error: delErr } = await supabase.from('jobs').delete().in('id', idBatch);
    if (delErr) throw delErr;
  }
```

- [ ] **Step 6: Use chunk() in db-supabase.ts finished-job purge**

Replace the purge-ids update block (lines ~866-873):

```typescript
    if ((purgeFiles || []).length > 0) {
      storagePaths.push(...(purgeFiles || []).map((f) => String(f.storage_path)));
      const purgeIds = (purgeFiles || []).map((f) => String(f.id));
      const { error: updateErr } = await supabase
        .from('job_files')
        .update({ storage_path: '', purged_at: now })
        .in('id', purgeIds);
      if (updateErr) throw updateErr;
    }
```

with:

```typescript
    if ((purgeFiles || []).length > 0) {
      storagePaths.push(...(purgeFiles || []).map((f) => String(f.storage_path)));
      const purgeIds = (purgeFiles || []).map((f) => String(f.id));
      for (const idBatch of chunk(purgeIds, 200)) {
        const { error: updateErr } = await supabase
          .from('job_files')
          .update({ storage_path: '', purged_at: now })
          .in('id', idBatch);
        if (updateErr) throw updateErr;
      }
    }
```

Also batch the `finishedIds`-driven `job_files` select above it (lines ~857-863) the same way if `finishedIds.length` can realistically exceed a few thousand — wrap in `for (const idBatch of chunk(finishedIds, 200))` and accumulate `purgeFiles` across batches.

- [ ] **Step 7: Apply the same batching to db.ts SQLite path**

SQLite's default `SQLITE_MAX_VARIABLE_NUMBER` is 999 (or lower on some builds). Find the equivalent `IN (${placeholders})` constructions in `src/lib/db.ts`'s `cleanupOldJobs` (search for `placeholders` near line 1107-1129) and wrap each in `for (const idBatch of chunk(ids, 200))`, rebuilding the placeholder string per batch. Import `chunk` from `./util`.

- [ ] **Step 8: Run full test suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/util.ts src/lib/util.test.ts src/lib/db.ts src/lib/db-supabase.ts
git commit -m "fix: batch cleanup deletes/updates to avoid oversized IN() queries on large backlogs"
```

---

### Task 4: Add cleanup audit log (counts + timestamp, no PII)

**Files:**
- Modify: `src/lib/db.ts` (SQLite schema init block, near line 163 `CREATE TABLE IF NOT EXISTS print_events`)
- Modify: `src/lib/db-supabase.ts` (new function `logCleanupRun`)
- Modify: `src/app/api/cleanup/route.ts` (`runCleanup`, call the logger)
- Create migration (Supabase): follow existing migration pattern — check `supabase/migrations/` directory for naming convention first.
- Test: `src/lib/db.test.ts` (create if absent) covering the SQLite logger.

**Interfaces:**
- Produces: `logCleanupRun(counts: { deletedJobs: number; jobFilesRemoved: number; strayFilesRemoved: number }): Promise<void>`, exported from both `db.ts` and `db-supabase.ts` with matching signatures (mirrors the `cleanupOldJobs` dual-backend pattern already in the file).

- [ ] **Step 1: Check existing migration convention**

Run: `ls C:/Users/Dev/Desktop/Selfprint/supabase/migrations` (or equivalent) to see naming format (e.g. `0007_delivery_role.sql`). Use the next sequential number.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/<next_number>_cleanup_events.sql`:

```sql
create table if not exists cleanup_events (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  deleted_jobs integer not null default 0,
  job_files_removed integer not null default 0,
  stray_files_removed integer not null default 0
);

create index if not exists idx_cleanup_events_ran_at on cleanup_events(ran_at desc);
```

- [ ] **Step 3: Add SQLite table**

In `src/lib/db.ts`, in the schema-init block right after the existing `CREATE TABLE IF NOT EXISTS print_events` block (around line 163-181), add:

```sql
    CREATE TABLE IF NOT EXISTS cleanup_events (
      id TEXT PRIMARY KEY,
      ran_at TEXT NOT NULL,
      deleted_jobs INTEGER NOT NULL DEFAULT 0,
      job_files_removed INTEGER NOT NULL DEFAULT 0,
      stray_files_removed INTEGER NOT NULL DEFAULT 0
    );
```

(Match exact SQL style/quoting already used for `print_events` in that same template literal — read the surrounding block before editing so formatting is consistent.)

- [ ] **Step 4: Write failing test for SQLite logCleanupRun**

Create/extend `src/lib/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { logCleanupRun } from "./db";

describe("logCleanupRun (SQLite)", () => {
  it("inserts a row with the given counts", async () => {
    await logCleanupRun({ deletedJobs: 3, jobFilesRemoved: 5, strayFilesRemoved: 1 });
    // Assert via a direct query using the same db connection db.ts exposes,
    // or via an exported test-only getter if one exists — check db.ts exports
    // for something like `getDb()`/`sqlite` before writing this assertion.
  });
});
```

Note for implementer: inspect `db.ts`'s exports first (`grep "^export" src/lib/db.ts`) to find how the SQLite connection is exposed for test assertions, and finish this test using that real export — do not invent an API.

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -- src/lib/db.test.ts`
Expected: FAIL — `logCleanupRun` not exported.

- [ ] **Step 6: Implement logCleanupRun in db.ts (SQLite)**

Add near `cleanupOldJobs` in `src/lib/db.ts`:

```typescript
export async function logCleanupRun(counts: {
  deletedJobs: number;
  jobFilesRemoved: number;
  strayFilesRemoved: number;
}): Promise<void> {
  if (useSupabase) {
    const mod = await import('./db-supabase');
    return mod.logCleanupRun(counts);
  }
  const sqlite = getDb(); // use whatever the file's existing accessor is named
  sqlite.prepare(`
    INSERT INTO cleanup_events (id, ran_at, deleted_jobs, job_files_removed, stray_files_removed)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), new Date().toISOString(), counts.deletedJobs, counts.jobFilesRemoved, counts.strayFilesRemoved);
}
```

Match the exact dual-backend dispatch pattern already used by `cleanupOldJobs` at line 1078-1081 (`useSupabase` flag name and `getDb()` accessor name must match what's actually in the file — read lines 1075-1090 before writing this).

- [ ] **Step 7: Implement logCleanupRun in db-supabase.ts**

Add near `cleanupOldJobs`:

```typescript
export async function logCleanupRun(counts: {
  deletedJobs: number;
  jobFilesRemoved: number;
  strayFilesRemoved: number;
}): Promise<void> {
  const { error } = await supabase.from('cleanup_events').insert({
    deleted_jobs: counts.deletedJobs,
    job_files_removed: counts.jobFilesRemoved,
    stray_files_removed: counts.strayFilesRemoved,
  });
  if (error) throw error;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- src/lib/db.test.ts`
Expected: PASS

- [ ] **Step 9: Wire into cleanup route**

In `src/app/api/cleanup/route.ts`, import `logCleanupRun` from `@/lib/db` and call it at the end of `runCleanup`, before returning the response:

```typescript
  await logCleanupRun({
    deletedJobs: deleted,
    jobFilesRemoved: storagePaths.length,
    strayFilesRemoved: strayPaths.length,
  });

  return NextResponse.json({
    deletedJobs: deleted,
    jobFilesRemoved: storagePaths.length,
    strayFilesRemoved: strayPaths.length
  });
```

- [ ] **Step 10: Apply the migration**

Use the Supabase MCP `apply_migration` tool (or `supabase db push` if working via CLI) — confirm with the user before applying to a shared/remote project.

- [ ] **Step 11: Run full test suite + typecheck**

Run: `npm run test && npm run typecheck`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations src/lib/db.ts src/lib/db-supabase.ts src/lib/db.test.ts src/app/api/cleanup/route.ts
git commit -m "feat: log cleanup run counts to cleanup_events for auditability"
```

---

### Task 5: Explicit retention for admin_login_events

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/lib/db-supabase.ts` (`cleanupOldJobs`, append a login-event purge step)
- Test: manual verification only (no SQLite equivalent — `admin_login_events` is Supabase/staff-auth-only per CLAUDE.md; skip SQLite path)

**Interfaces:**
- Produces: `LOGIN_EVENT_RETENTION_DAYS` exported number constant.

- [ ] **Step 1: Add constant to config.ts**

```typescript
// Staff login-event history (admin_login_events) is purged after this many
// days. Job/order history is kept forever by design (see FILE_RETENTION_DAYS
// comment above) — this constant applies only to auth audit log rows, which
// carry no customer order data.
export const LOGIN_EVENT_RETENTION_DAYS = Number(process.env.LOGIN_EVENT_RETENTION_DAYS ?? 365);
```

- [ ] **Step 2: Confirm admin_login_events schema**

Run `grep -n "admin_login_events" src/lib/db-supabase.ts` and read the surrounding insert code to confirm the timestamp column name (likely `created_at` or `logged_at`) before writing the delete query.

- [ ] **Step 3: Add purge step to cleanupOldJobs in db-supabase.ts**

At the end of `cleanupOldJobs`, before `return { deleted: abandonedIds.length, storagePaths };`, add:

```typescript
  // Auth audit log retention — independent of order-history retention.
  const loginEventCutoff = new Date(Date.now() - LOGIN_EVENT_RETENTION_DAYS * 24 * 60 * 60000).toISOString();
  const { error: loginPurgeErr } = await supabase
    .from('admin_login_events')
    .delete()
    .lt('created_at', loginEventCutoff); // adjust column name per Step 2 finding
  if (loginPurgeErr) throw loginPurgeErr;
```

Add `LOGIN_EVENT_RETENTION_DAYS` to the existing config import at the top of the file.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Manually verify against a Supabase dev/staging project**

Insert a fake old row via SQL editor with a `created_at` older than the cutoff, run `/api/cleanup` locally against that project, confirm the row is gone and recent rows remain.

- [ ] **Step 6: Commit**

```bash
git add src/lib/config.ts src/lib/db-supabase.ts
git commit -m "feat: purge admin_login_events older than LOGIN_EVENT_RETENTION_DAYS"
```

---

### Task 6: Update .env.example and docs

**Files:**
- Modify: `.env.example`
- Modify: `CLAUDE.md` (Environment Variables section)

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Add new env vars to .env.example**

```
# Cleanup / retention (all optional, sane defaults shown)
CART_ABANDON_MINUTES=1440
STRAY_FILE_RETENTION_HOURS=2
LOGIN_EVENT_RETENTION_DAYS=365
```

- [ ] **Step 2: Update CLAUDE.md Environment Variables line**

Append to the "Key variables" list in the Environment Variables section: `CART_ABANDON_MINUTES`, `STRAY_FILE_RETENTION_HOURS`, `LOGIN_EVENT_RETENTION_DAYS`.

- [ ] **Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: document new cleanup/retention env vars"
```

---

---

### Task 7: Store retention settings in DB, editable without redeploy

**Files:**
- Modify: `src/lib/types.ts` (extend `PricingConfig` or add new `RetentionConfig` type — use a separate type, retention is not pricing)
- Modify: `src/lib/db-supabase.ts` (new `getRetentionConfig` / `updateRetentionConfig`, new `retention_config` table)
- Modify: `src/lib/db.ts` (SQLite equivalents + schema)
- Modify: `src/lib/db-supabase.ts` `cleanupOldJobs`, `src/lib/db.ts` `cleanupOldJobs`, `src/app/api/cleanup/route.ts` — read live values from `getRetentionConfig()` instead of the static `config.ts` constants added in Tasks 1-2, keeping the `config.ts` constants only as fallback defaults.
- Create migration: `supabase/migrations/<next_number>_retention_config.sql`
- Test: `src/lib/db.test.ts`

**Interfaces:**
- Produces: `RetentionConfig` type `{ cartAbandonMinutes: number; fileRetentionDays: number; strayFileRetentionHours: number; loginEventRetentionDays: number }`; `getRetentionConfig(): Promise<RetentionConfig>` and `updateRetentionConfig(config: RetentionConfig): Promise<void>`, exported from both `db.ts` and `db-supabase.ts` with matching signatures (mirrors `getPricing`/`updatePricing` at `src/lib/db-supabase.ts:595-651`).

- [ ] **Step 1: Add RetentionConfig type**

In `src/lib/types.ts`, add near `PricingConfig`:

```typescript
export type RetentionConfig = {
  cartAbandonMinutes: number;
  fileRetentionDays: number;
  strayFileRetentionHours: number;
  loginEventRetentionDays: number;
};
```

- [ ] **Step 2: Write the migration**

```sql
create table if not exists retention_config (
  id integer primary key default 1,
  cart_abandon_minutes integer not null default 1440,
  file_retention_days integer not null default 3,
  stray_file_retention_hours integer not null default 2,
  login_event_retention_days integer not null default 365,
  updated_at timestamptz not null default now(),
  constraint retention_config_singleton check (id = 1)
);

insert into retention_config (id) values (1) on conflict (id) do nothing;
```

- [ ] **Step 3: Add SQLite table**

In `src/lib/db.ts` schema-init block, add (matching the existing `pricing_config` table's single-row pattern — read that block first for exact style):

```sql
    CREATE TABLE IF NOT EXISTS retention_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cart_abandon_minutes INTEGER NOT NULL DEFAULT 1440,
      file_retention_days INTEGER NOT NULL DEFAULT 3,
      stray_file_retention_hours INTEGER NOT NULL DEFAULT 2,
      login_event_retention_days INTEGER NOT NULL DEFAULT 365,
      updated_at TEXT
    );
```

- [ ] **Step 4: Write failing test for getRetentionConfig defaults**

```typescript
// src/lib/db.test.ts (append)
import { getRetentionConfig } from "./db";

describe("getRetentionConfig", () => {
  it("returns sane defaults when no row exists yet", async () => {
    const cfg = await getRetentionConfig();
    expect(cfg).toEqual({
      cartAbandonMinutes: 1440,
      fileRetentionDays: 3,
      strayFileRetentionHours: 2,
      loginEventRetentionDays: 365,
    });
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test -- src/lib/db.test.ts`
Expected: FAIL — `getRetentionConfig` not exported.

- [ ] **Step 6: Implement getRetentionConfig / updateRetentionConfig in db-supabase.ts**

Follow the exact `getPricing`/`updatePricing` pattern at lines 595-651 (single row, `id = 1`, `PGRST116` → defaults fallback):

```typescript
const RETENTION_DEFAULTS: RetentionConfig = {
  cartAbandonMinutes: 1440,
  fileRetentionDays: 3,
  strayFileRetentionHours: 2,
  loginEventRetentionDays: 365,
};

export async function getRetentionConfig(): Promise<RetentionConfig> {
  const { data, error } = await supabase
    .from('retention_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (error) {
    if ((error as any).code === 'PGRST116') return RETENTION_DEFAULTS;
    throw error;
  }

  return {
    cartAbandonMinutes: data.cart_abandon_minutes ?? RETENTION_DEFAULTS.cartAbandonMinutes,
    fileRetentionDays: data.file_retention_days ?? RETENTION_DEFAULTS.fileRetentionDays,
    strayFileRetentionHours: data.stray_file_retention_hours ?? RETENTION_DEFAULTS.strayFileRetentionHours,
    loginEventRetentionDays: data.login_event_retention_days ?? RETENTION_DEFAULTS.loginEventRetentionDays,
  };
}

export async function updateRetentionConfig(config: RetentionConfig): Promise<void> {
  const { error } = await supabase
    .from('retention_config')
    .upsert({
      id: 1,
      cart_abandon_minutes: config.cartAbandonMinutes,
      file_retention_days: config.fileRetentionDays,
      stray_file_retention_hours: config.strayFileRetentionHours,
      login_event_retention_days: config.loginEventRetentionDays,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}
```

- [ ] **Step 7: Implement SQLite equivalents in db.ts**

Mirror `getPricing`/`updatePricing`'s SQLite branch (find it via `grep -n "function getPricing" src/lib/db.ts`) using `INSERT ... ON CONFLICT(id) DO UPDATE` or a manual upsert against `retention_config`, matching whichever style the existing pricing functions use.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test -- src/lib/db.test.ts`
Expected: PASS

- [ ] **Step 9: Replace static constants with live config in cleanup paths**

In `src/app/api/cleanup/route.ts` and both `cleanupOldJobs` implementations, replace direct use of `CART_ABANDON_MINUTES`, `FILE_RETENTION_DAYS`, `STRAY_FILE_RETENTION_HOURS`, `LOGIN_EVENT_RETENTION_DAYS` (from Tasks 1-2 and 5) with a single `const retention = await getRetentionConfig()` call, then use `retention.cartAbandonMinutes` etc. Keep the `config.ts` env-var constants as the `RETENTION_DEFAULTS` fallback values only (Step 6/7 already wire this in) — do not delete them, they're what seeds the defaults on a fresh install.

- [ ] **Step 10: Apply the migration and run full suite**

Apply via Supabase MCP `apply_migration` (confirm with user first). Run: `npm run test && npm run typecheck`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations src/lib/types.ts src/lib/db.ts src/lib/db-supabase.ts src/lib/db.test.ts src/app/api/cleanup/route.ts
git commit -m "feat: move retention settings into DB-backed config, editable without redeploy"
```

---

### Task 8: Admin "Data Management" UI page

**Files:**
- Create: `src/app/admin/data-retention/page.tsx`
- Create: `src/app/api/admin/retention/route.ts` (GET current config, PUT updated config — follow the auth/role-check pattern used in `src/app/api/admin/jobs/route.ts` or similar; restrict to `super_admin` role since this affects data deletion)
- Modify: `src/app/admin/layout.tsx` (add nav link)
- Modify: `src/app/admin/management.css` (reuse existing admin form styling, no new design system)

**Interfaces:**
- Consumes: `getRetentionConfig`/`updateRetentionConfig` from Task 7, `RetentionConfig` type from `src/lib/types.ts`.
- Produces: page at `/admin/data-retention` rendering a form with 4 numeric fields (cart abandon minutes, file retention days, stray file retention hours, login event retention days) and a "Last cleanup run" panel reading the most recent `cleanup_events` row (Task 4) so the admin can see counts/timestamp of the last purge, not just configure future ones.

- [ ] **Step 1: Check an existing admin settings page for the auth/role pattern**

Run: `grep -n "super_admin\|requireRole\|staff_profiles" src/app/api/admin/*/route.ts` (or read `src/app/admin/staff/page.tsx` + its API route) to copy the exact session-check and role-gate pattern already used elsewhere in `src/app/api/admin/`.

- [ ] **Step 2: Create the API route**

`src/app/api/admin/retention/route.ts` — GET returns `getRetentionConfig()` plus the latest `cleanup_events` row; PUT validates the 4 fields are positive integers and calls `updateRetentionConfig`. Use the exact same auth guard found in Step 1 (do not invent a new auth mechanism). Example shape (fill in the real guard from Step 1 before writing):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getRetentionConfig, updateRetentionConfig, getLatestCleanupEvent } from "@/lib/db";
// import the real auth guard found in Step 1, e.g. requireStaffRole

export async function GET(request: NextRequest) {
  // auth guard here (super_admin only) — copy exact pattern from Step 1
  const config = await getRetentionConfig();
  const lastRun = await getLatestCleanupEvent();
  return NextResponse.json({ config, lastRun });
}

export async function PUT(request: NextRequest) {
  // auth guard here (super_admin only)
  const body = await request.json();
  const { cartAbandonMinutes, fileRetentionDays, strayFileRetentionHours, loginEventRetentionDays } = body;
  const fields = { cartAbandonMinutes, fileRetentionDays, strayFileRetentionHours, loginEventRetentionDays };
  for (const [key, value] of Object.entries(fields)) {
    if (!Number.isInteger(value) || value <= 0) {
      return NextResponse.json({ error: `${key} must be a positive integer` }, { status: 400 });
    }
  }
  await updateRetentionConfig(fields);
  return NextResponse.json({ ok: true });
}
```

Add `getLatestCleanupEvent(): Promise<{ ranAt: string; deletedJobs: number; jobFilesRemoved: number; strayFilesRemoved: number } | null>` to both `db.ts` and `db-supabase.ts` (simple `SELECT * FROM cleanup_events ORDER BY ran_at DESC LIMIT 1`), following the Task 4 table.

- [ ] **Step 3: Create the admin page**

`src/app/admin/data-retention/page.tsx` — client component, fetches `GET /api/admin/retention` on mount, renders a form (reuse existing admin form CSS classes from `management.css` — check `src/app/admin/staff/page.tsx` for the exact class names already in use rather than inventing new ones), submits `PUT` on save, shows a success/error toast consistent with other admin pages, and displays the last-cleanup-run panel (timestamp + 3 counts) read-only.

- [ ] **Step 4: Add nav link**

In `src/app/admin/layout.tsx`, add a "Data Management" link to `/admin/data-retention` next to the existing nav entries (match existing link markup exactly).

- [ ] **Step 5: Manual verification in browser**

Start dev server, log in as super_admin, navigate to `/admin/data-retention`, change a value, save, reload, confirm it persisted. Confirm a non-super_admin staff account gets rejected (403/redirect) per the Step 1 auth guard.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/data-retention src/app/api/admin/retention src/app/admin/layout.tsx src/app/admin/management.css src/lib/db.ts src/lib/db-supabase.ts
git commit -m "feat: add admin Data Management page for retention settings"
```

---

## Explicitly Out of Scope (already correct or conflicts with stated requirement, no task needed)

- Job row + `job_files.original_name` retained forever, `storage_path` cleared after `FILE_RETENTION_DAYS` (default 3) — this is the current behavior in both `db.ts` and `db-supabase.ts` and matches what was requested. No change.
- Auto-purging the full job row for old `printed`/`cancelled`/`failed` orders — explicitly rejected: user wants full order history (completed + failed jobs) kept forever. Only file bytes are ever deleted (Task 7's `fileRetentionDays`, admin-editable).
