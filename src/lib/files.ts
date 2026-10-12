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
export type PageCountSource = "pdfium" | "pdfjs" | "fixed";

// Thrown when neither real PDF parser can read a file. The old byte-regex
// fallback is gone on purpose: on compressed scans it finds zero markers and
// bills a 657-page file as 1 page (token 772168: Rs 717 billed as Rs 31),
// and on extracts with dead markers it overbills. Refusing is cheaper than
// misbilling — callers turn this into a 400 asking for a re-saved file.
export class PageCountError extends Error {
  encrypted: boolean;
  details: string | null;
  constructor(opts?: { encrypted?: boolean; details?: string | null }) {
    super("Could not determine the page count of this PDF");
    this.encrypted = opts?.encrypted ?? false;
    this.details = opts?.details ?? null;
  }
}

export async function estimatePageCount(kind: FileKind, bytes: Buffer): Promise<number> {
  return (await estimatePageCountWithSource(kind, bytes)).count;
}

export async function estimatePageCountWithSource(
  kind: FileKind,
  bytes: Buffer
): Promise<{ count: number; source: PageCountSource }> {
  if (kind === "image") return { count: 1, source: "fixed" };
  if (kind === "document") return { count: 0, source: "fixed" };
  const failures: string[] = [];
  // Real page count via PDFium — the same engine the agent prints with. The
  // old regex counted /Type /Page occurrences in raw bytes, which modern
  // PDFs hide inside compressed object streams: a 300-page file was billed
  // as ~1 page while the agent still printed all of them.
  const viaPdfium = await countPagesViaPdfium(bytes, failures);
  if (viaPdfium !== null) return { count: Math.max(viaPdfium, 1), source: "pdfium" };
  // Second real parse via pdf.js (follows the live page tree, ignores
  // orphaned / dead objects). This is what saves non-optimized extracts:
  // e.g. a "print 3 pages from a book" PDF that shows 3 pages but still
  // carries the book's stale /Type /Page markers in dead bytes — the naive
  // regex below would bill all of them (reported case: 6 real pages billed
  // as 58). pdf.js counts only live pages, like PDFium and the viewer.
  const viaPdfjs = await countPagesViaPdfJs(bytes, failures);
  if (viaPdfjs !== null) {
    console.warn("[estimatePageCount] PDFium failed, used pdf.js fallback");
    return { count: Math.max(viaPdfjs, 1), source: "pdfjs" };
  }
  // Both real parsers failed (malformed PDF, encrypted file, or the
  // engines couldn't load in this runtime) — throw instead of guessing.
  // A regex heuristic here is known-wrong in both directions (undercounts
  // compressed object streams, overcounts dead markers in extracts), and a
  // wrong count becomes a wrong price. The caller rejects the upload so the
  // customer re-saves the file instead of being misbilled.
  const details = failures.length > 0 ? failures.join(" | ").slice(0, 500) : null;
  console.warn(`[estimatePageCount] both parsers failed (${bytes.length} bytes): ${details ?? "unknown"}`);
  throw new PageCountError({ encrypted: isEncryptedPdf(bytes, failures), details });
}

// PDFium parse. Returns null (instead of throwing) when the engine or the
// file can't be handled, so the caller can try the next parser.
async function countPagesViaPdfium(bytes: Buffer, failures?: string[]): Promise<number | null> {
  // Attempt 1: default init — the library locates pdfium.wasm next to its
  // own package. Works in plain Node / local dev.
  try {
    return await loadWithPdfium(bytes);
  } catch (e) {
    failures?.push(`pdfium-default: ${errMsg(e)}`);
    // Fall through to the explicit-binary retry below.
  }
  // Attempt 2: pass the wasm binary explicitly. Bundled servers (Next.js
  // production, serverless) relocate the importing chunk, so the library's
  // `new URL("pdfium.wasm", import.meta.url)` no longer points at
  // node_modules and default init fails — resolving the real path ourselves
  // survives that. Without this, every PDF in prod fell through to the
  // regex heuristic (e.g. a 3-page extract billed as 55).
  try {
    const wasmBinary = await readPdfiumWasmBinary();
    if (wasmBinary) return await loadWithPdfium(bytes, wasmBinary);
    failures?.push("pdfium-explicit: wasm binary missing");
  } catch (e) {
    failures?.push(`pdfium-explicit: ${errMsg(e)}`);
    // Fall through to null — the caller tries pdf.js next.
  }
  return null;
}

async function loadWithPdfium(bytes: Buffer, wasmBinary?: ArrayBuffer): Promise<number> {
  const { PDFiumLibrary } = await import("@hyzyla/pdfium");
  const lib = await PDFiumLibrary.init(wasmBinary ? { wasmBinary } : undefined);
  try {
    // Zero-copy view — new Uint8Array(bytes) duplicates 50MB uploads, which
    // OOMs small serverless functions before parsing even starts.
    const doc = await lib.loadDocument(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    const count = doc.getPageCount();
    doc.destroy();
    if (typeof count !== "number" || !Number.isFinite(count)) throw new Error("bad page count");
    return count;
  } finally {
    lib.destroy?.();
  }
}

// Reads the PDFium wasm binary from its installed package. Exported for tests.
export async function readPdfiumWasmBinary(): Promise<ArrayBuffer | null> {
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@hyzyla/pdfium/pdfium.wasm");
    const fs = await import("node:fs/promises");
    const buf = await fs.readFile(wasmPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

// pdf.js parse (no worker — Node has no WebWorker here; the library falls
// back to the main-thread "fake worker"). Exported for tests.
export async function countPagesViaPdfJs(bytes: Buffer, failures?: string[]): Promise<number | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
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
  } catch (e) {
    failures?.push(`pdfjs: ${errMsg(e)}`);
    return null;
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 200);
  return String(e).slice(0, 200);
}

// Password-protected PDFs fail both parsers by design — detect so caller
// can tell user to remove password instead of generic re-save advice.
function isEncryptedPdf(bytes: Buffer, failures: string[]): boolean {
  const joined = failures.join(" ").toLowerCase();
  if (joined.includes("password") || joined.includes("encrypt")) return true;
  // ponytail: latin1 scan of whole buffer, runs only on double-parser failure
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return false;
  return bytes.toString("latin1", 0, Math.min(bytes.length, 1_000_000)).includes("/Encrypt");
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
