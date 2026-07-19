import { describe, it, expect } from "vitest";
import { parseBulkFiles, sumPages, MAX_BULK_FILES, type BulkFileMeta } from "./bulk";

function pdf(n: number, overrides: Partial<BulkFileMeta> = {}): BulkFileMeta {
  // storedName must be a server-issued UUID name (isValidStoredName).
  return {
    storedName: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}.pdf`,
    originalName: `doc${n}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1000,
    pageCount: 2,
    uploadSig: "",
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
