import crypto from "node:crypto";
import path from "node:path";
import { ORIGINALS_DIR, CONVERTED_DIR, MAX_UPLOAD_BYTES } from "./config";
import type { FileKind } from "./types";
import { saveUpload as saveToStorage, readFileBytes } from "./storage";

const allowed = new Map<string, { extensions: string[]; kind: FileKind }>([
  ["application/pdf", { extensions: [".pdf"], kind: "pdf" }],
  ["image/jpeg", { extensions: [".jpg", ".jpeg"], kind: "image" }],
  ["image/png", { extensions: [".png"], kind: "image" }]
]);

export function validateUpload(fileName: string, mimeType: string) {
  const ext = path.extname(fileName).toLowerCase();
  const rule = allowed.get(mimeType);
  if (!rule || !rule.extensions.includes(ext)) {
    throw new Error("Only PDF, JPG, and PNG files are allowed. Please convert Word documents to PDF before uploading.");
  }
  return { ext, kind: rule.kind };
}

export async function saveUpload(file: File, ext: string, kind: FileKind = "pdf") {
  return saveToStorage(file, ext, kind);
}

// Which engine produced a page count. Exposed in the job-creation response
// (`pageCountSource`) so a miscount can be traced to its layer without
// server-log access. "fixed" = trivial image/document answer, no parse.
export type PageCountSource = "pdfium" | "pdfjs" | "regex" | "fixed";

export async function estimatePageCount(kind: FileKind, bytes: Buffer): Promise<number> {
  return (await estimatePageCountWithSource(kind, bytes)).count;
}

export async function estimatePageCountWithSource(
  kind: FileKind,
  bytes: Buffer
): Promise<{ count: number; source: PageCountSource }> {
  if (kind === "image") return { count: 1, source: "fixed" };
  if (kind === "document") return { count: 0, source: "fixed" };
  // Real page count via PDFium — the same engine the agent prints with. The
  // old regex counted /Type /Page occurrences in raw bytes, which modern
  // PDFs hide inside compressed object streams: a 300-page file was billed
  // as ~1 page while the agent still printed all of them.
  const viaPdfium = await countPagesViaPdfium(bytes);
  if (viaPdfium !== null) return { count: Math.max(viaPdfium, 1), source: "pdfium" };
  // Second real parse via pdf.js (follows the live page tree, ignores
  // orphaned / dead objects). This is what saves non-optimized extracts:
  // e.g. a "print 3 pages from a book" PDF that shows 3 pages but still
  // carries the book's stale /Type /Page markers in dead bytes — the naive
  // regex below would bill all of them (reported case: 6 real pages billed
  // as 58). pdf.js counts only live pages, like PDFium and the viewer.
  const viaPdfjs = await countPagesViaPdfJs(bytes);
  if (viaPdfjs !== null) {
    console.warn("[estimatePageCount] PDFium failed, used pdf.js fallback");
    return { count: Math.max(viaPdfjs, 1), source: "pdfjs" };
  }
  // Both real parsers failed (malformed PDF or engine unavailable) — fall
  // back to the byte-regex heuristic rather than failing the upload. Known
  // to overcount unoptimized extracts with orphaned markers and undercount
  // compressed object streams, so this is strictly a last resort.
  console.warn("[estimatePageCount] PDFium and pdf.js failed, used regex heuristic");
  const text = bytes.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return { count: Math.max(matches?.length ?? 1, 1), source: "regex" };
}

// PDFium parse. Returns null (instead of throwing) when the engine or the
// file can't be handled, so the caller can try the next parser.
async function countPagesViaPdfium(bytes: Buffer): Promise<number | null> {
  try {
    const { PDFiumLibrary } = await import("@hyzyla/pdfium");
    const lib = await PDFiumLibrary.init();
    try {
      const doc = await lib.loadDocument(new Uint8Array(bytes));
      const count = doc.getPageCount();
      doc.destroy();
      return typeof count === "number" && Number.isFinite(count) ? count : null;
    } finally {
      lib.destroy?.();
    }
  } catch {
    return null;
  }
}

// pdf.js parse (no worker — Node has no WebWorker here; the library falls
// back to the main-thread "fake worker"). Exported for tests.
export async function countPagesViaPdfJs(bytes: Buffer): Promise<number | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useWorkerFetch: false,
    } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
    const num = (doc as unknown as { numPages?: unknown }).numPages;
    try {
      await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      // Ignore cleanup errors — the count was already read.
    }
    return typeof num === "number" && Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

/**
 * Reads an already-uploaded object back from storage and derives its real size
 * and page count. Used by the direct-upload and bulk flows, where the browser
 * uploads straight to Supabase Storage: the client's own reported sizeBytes /
 * pageCount must never reach pricing, because a forged `pageCount=1` on a
 * 300-page PDF would be billed as one page while the agent still prints all
 * 300. Costs one object download, which is why it runs once per job creation.
 */
export async function measureStoredFile(
  kind: FileKind,
  storagePath: string
): Promise<{ sizeBytes: number; pageCount: number; pageCountSource: PageCountSource }> {
  const bytes = await readFileBytes(storagePath);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error("File is too large");
  }
  const { count, source } = await estimatePageCountWithSource(kind, bytes);
  return { sizeBytes: bytes.length, pageCount: count, pageCountSource: source };
}
