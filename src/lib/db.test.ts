import { describe, it, expect, beforeAll, beforeEach } from "vitest";
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

describe("getLatestCleanupEvent (SQLite)", () => {
  let db: typeof import("./db");
  beforeAll(async () => {
    db = await import("./db");
    await db.ensureDatabase();
  });

  beforeEach(() => {
    const raw = new Database("./data-test-cleanup-events.sqlite");
    raw.prepare("DELETE FROM cleanup_events").run();
    raw.close();
  });

  it("returns null when no cleanup has run yet", async () => {
    const latest = await db.getLatestCleanupEvent();
    expect(latest).toBeNull();
  });

  it("returns the most recent run's counts", async () => {
    await db.logCleanupRun({ deletedJobs: 1, jobFilesRemoved: 2, strayFilesRemoved: 0 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.logCleanupRun({ deletedJobs: 9, jobFilesRemoved: 8, strayFilesRemoved: 7 });

    const latest = await db.getLatestCleanupEvent();
    expect(latest).not.toBeNull();
    expect(latest?.deletedJobs).toBe(9);
    expect(latest?.jobFilesRemoved).toBe(8);
    expect(latest?.strayFilesRemoved).toBe(7);
    expect(latest?.ranAt).toBeTruthy();
  });
});

describe("getRetentionConfig", () => {
  let db: typeof import("./db");
  beforeAll(async () => {
    db = await import("./db");
    await db.ensureDatabase();
  });

  beforeEach(async () => {
    const raw = new Database("./data-test-cleanup-events.sqlite");
    raw.prepare("DELETE FROM retention_config").run();
    raw.close();
  });

  it("returns sane defaults when no row exists yet", async () => {
    const cfg = await db.getRetentionConfig();
    expect(cfg).toEqual({
      cartAbandonMinutes: 1440,
      fileRetentionDays: 3,
      strayFileRetentionHours: 2,
      loginEventRetentionDays: 365,
    });
  });

  it("round-trips an update through updateRetentionConfig and getRetentionConfig", async () => {
    await db.updateRetentionConfig({
      cartAbandonMinutes: 42,
      fileRetentionDays: 9,
      strayFileRetentionHours: 5,
      loginEventRetentionDays: 100,
    });

    const cfg = await db.getRetentionConfig();
    expect(cfg).toEqual({
      cartAbandonMinutes: 42,
      fileRetentionDays: 9,
      strayFileRetentionHours: 5,
      loginEventRetentionDays: 100,
    });
  });
});

describe("cleanupOldJobs file purge invariant (SQLite)", () => {
  let db: typeof import("./db");
  beforeAll(async () => {
    db = await import("./db");
    await db.ensureDatabase();
  });

  it("purges storage_path but keeps job_files metadata and the job row", async () => {
    // Make the file-retention window effectively zero so a freshly finished
    // job is immediately eligible for the privacy purge.
    await db.updateRetentionConfig({
      cartAbandonMinutes: 1440,
      fileRetentionDays: 0,
      strayFileRetentionHours: 2,
      loginEventRetentionDays: 365,
    });

    const { jobId, fileId } = await db.createJob(
      {
        token: "test-token-" + Math.random().toString(36).slice(2),
        printType: "bw",
        copies: 1,
        paperSize: "A4",
        layout: "portrait",
        pagesPerSheet: 1,
        margins: "normal",
        scale: 100,
        duplex: "simplex",
        pageCount: 1,
        pricePaise: 100,
        needsConversion: 0,
        queuePosition: 1,
      },
      {
        originalName: "report.pdf",
        storedName: "stored-report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1234,
        fileKind: "pdf",
        storagePath: "originals/stored-report.pdf",
      }
    );

    await db.updateJobStatus(jobId, "printed");

    // Ensure the job's created_at is strictly before the purge cutoff computed
    // inside cleanupOldJobs (which uses Date.now() at call time).
    await new Promise((resolve) => setTimeout(resolve, 5));

    await db.cleanupOldJobs();

    const raw = new Database("./data-test-cleanup-events.sqlite", { readonly: true });
    const jobRow = raw.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Record<string, unknown> | undefined;
    const fileRow = raw.prepare("SELECT * FROM job_files WHERE id = ?").get(fileId) as Record<string, unknown> | undefined;
    raw.close();

    expect(jobRow).toBeTruthy();
    expect(fileRow).toBeTruthy();
    expect(fileRow!.storage_path).toBe("");
    expect(fileRow!.original_name).toBe("report.pdf");
  });
});
