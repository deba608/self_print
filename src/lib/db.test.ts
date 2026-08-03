import { describe, it, expect, beforeAll } from "vitest";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";

// Force SQLite backend + isolated DB file BEFORE importing db.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.DATABASE_PATH = "./data-test-cleanup-events.sqlite";

// Delete any stale test DB before the run so each run starts clean.
try { rmSync("./data-test-cleanup-events.sqlite", { force: true }); } catch {}

describe("logCleanupRun (SQLite)", () => {
  let db: typeof import("./db");
  beforeAll(async () => {
    db = await import("./db");
    await db.ensureDatabase();
  });

  it("inserts a row with the given counts", async () => {
    await db.logCleanupRun({ deletedJobs: 3, jobFilesRemoved: 5, strayFilesRemoved: 1 });

    const raw = new Database("./data-test-cleanup-events.sqlite", { readonly: true });
    const rows = raw.prepare("SELECT * FROM cleanup_events").all() as Array<{
      deleted_jobs: number;
      job_files_removed: number;
      stray_files_removed: number;
      ran_at: string;
    }>;
    raw.close();

    expect(rows).toHaveLength(1);
    expect(rows[0].deleted_jobs).toBe(3);
    expect(rows[0].job_files_removed).toBe(5);
    expect(rows[0].stray_files_removed).toBe(1);
    expect(rows[0].ran_at).toBeTruthy();
  });
});
