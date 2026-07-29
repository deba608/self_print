import { describe, expect, it } from "vitest";
import { estimatePdfPages } from "./pdf-pages";

// latin1-safe helper: builds a File whose bytes are the given ASCII string.
function pdfFile(content: string): File {
  return new File([new TextEncoder().encode(content)], "test.pdf", { type: "application/pdf" });
}

describe("estimatePdfPages", () => {
  it("counts /Type /Page objects", async () => {
    const body = "%PDF-1.4\n" + "1 0 obj << /Type /Page >> endobj\n".repeat(7);
    expect(await estimatePdfPages(pdfFile(body))).toBe(7);
  });

  it("does not count the /Type /Pages tree root", async () => {
    const body = "%PDF-1.4\n<< /Type /Pages /Kids [] >>\n<< /Type /Page >>\n";
    expect(await estimatePdfPages(pdfFile(body))).toBe(1);
  });

  it("tolerates arbitrary whitespace between tokens", async () => {
    const body = "<< /Type\n  \t /Page >>\n<< /Type/Page >>\n";
    expect(await estimatePdfPages(pdfFile(body))).toBe(2);
  });

  it("returns at least 1 for files with no match", async () => {
    expect(await estimatePdfPages(pdfFile("%PDF-1.4 empty"))).toBe(1);
  });

  it("counts matches spanning chunk boundaries without double counting", async () => {
    // Small chunk size forces many boundaries; markers are placed so several
    // land across a boundary and several sit fully inside the overlap tail.
    const marker = "<< /Type /Page >>";
    const parts: string[] = [];
    for (let i = 0; i < 40; i++) {
      parts.push("x".repeat(13 + (i % 7)));
      parts.push(marker);
    }
    const body = "%PDF-1.4\n" + parts.join("");
    expect(await estimatePdfPages(pdfFile(body), 64)).toBe(40);
  });

  it("does not count /Type /Pages split by a chunk boundary before its final s", async () => {
    // chunkSize 32 puts the first boundary exactly between "Page" and "s",
    // where the marker regex's \b would match end-of-chunk if unguarded.
    const body = "A".repeat(21) + "/Type /Pages" + " << /Type /Page >>";
    expect(body.indexOf("s", 21)).toBe(32);
    expect(await estimatePdfPages(pdfFile(body), 32)).toBe(1);
  });

  it("matches the whole-file scan on a larger randomized document", async () => {
    let body = "%PDF-1.4\n";
    let expected = 0;
    for (let i = 0; i < 500; i++) {
      body += "obj".repeat((i * 31) % 50);
      if (i % 3 === 0) {
        body += "<< /Type /Page >>";
        expected++;
      }
      if (i % 11 === 0) body += "<< /Type /Pages >>";
    }
    expect(await estimatePdfPages(pdfFile(body), 256)).toBe(expected);
  });
});
