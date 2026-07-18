import { describe, it, expect, beforeAll } from "vitest";
import { rmSync } from "node:fs";

// Force SQLite backend + isolated DB file BEFORE importing db.
process.env.SUPABASE_URL = "";
process.env.SUPABASE_SERVICE_ROLE_KEY = "";
process.env.DATABASE_PATH = "./data-test-bulk.sqlite";

// Delete any stale test DB before the run so each run starts clean.
try { rmSync("./data-test-bulk.sqlite", { force: true }); } catch {}

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
