import { describe, expect, it } from "vitest";
import { countPagesViaPdfJs, estimatePageCount } from "./files";

// Simulates a non-optimized "extract pages" PDF like the reported token
// 561440 case: 5 live pages, but stale /Type /Page markers from the source
// book lingering in dead bytes after %%EOF. Real parsers (PDFium, pdf.js)
// ignore the trailing garbage; the naive byte-regex would bill 5 + 50.
async function poisonedGuideBytes(staleMarkers = 50): Promise<Buffer> {
  const fs = await import("node:fs");
  const base = fs.readFileSync("docs/CUSTOMER_USER_GUIDE.pdf");
  const stale = Buffer.from("<< /Type /Page >>\n".repeat(staleMarkers), "latin1");
  return Buffer.concat([base, Buffer.from("\n% stale booking data\n", "latin1"), stale]);
}

describe("estimatePageCount", () => {
  it("counts a real PDF accurately", async () => {
    const fs = await import("node:fs");
    const bytes = fs.readFileSync("docs/CUSTOMER_USER_GUIDE.pdf");
    expect(await estimatePageCount("pdf", bytes)).toBe(5);
  });

  it("ignores stale /Type /Page markers outside the live page tree", async () => {
    const bytes = await poisonedGuideBytes(50);
    // Naive regex would see 55+ markers; the estimator must see 5 live pages.
    expect(await estimatePageCount("pdf", bytes)).toBe(5);
  });

  it("returns 1 for images and 0 for documents", async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    expect(await estimatePageCount("image", bytes)).toBe(1);
    expect(await estimatePageCount("document", bytes)).toBe(0);
  });

  it("never throws on garbage bytes", async () => {
    const count = await estimatePageCount("pdf", Buffer.from("not a pdf at all"));
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe("countPagesViaPdfJs", () => {
  it("counts live pages despite stale markers (the pdf.js fallback layer)", async () => {
    const bytes = await poisonedGuideBytes(50);
    expect(await countPagesViaPdfJs(bytes)).toBe(5);
  });

  it("returns null for garbage instead of throwing", async () => {
    expect(await countPagesViaPdfJs(Buffer.from("not a pdf at all"))).toBeNull();
  });
});
