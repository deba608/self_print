"use client";

// Shared pdf.js bootstrap for client-side preview components (PdfViewer,
// PdfCanvasPreview, BulkThumb). Keeps the worker path and getDocument options
// in one place so they can't drift between call sites.

export type PdfJsDoc = {
  destroy: () => Promise<void> | void;
  numPages: number;
  getPage: (page: number) => Promise<any>;
};

let workerConfigured = false;

async function getPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerConfigured = true;
  }
  return pdfjs;
}

const GET_DOCUMENT_OPTIONS = {
  disableFontFace: true,
  isEvalSupported: false,
  useWorkerFetch: false,
};

export async function loadPdfFromBytes(data: Uint8Array): Promise<PdfJsDoc> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({
    data,
    ...GET_DOCUMENT_OPTIONS,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
  return doc as unknown as PdfJsDoc;
}

export async function loadPdfDocument(file: File): Promise<PdfJsDoc> {
  const data = await file.arrayBuffer();
  return loadPdfFromBytes(new Uint8Array(data));
}

// Fetches a PDF's raw bytes with optional progress reporting (loaded/total in
// bytes). Used by PdfViewer to drive a "loading X%" bar on slow connections —
// a plain `getDocument({url})` gives no hook into per-chunk progress here
// since we proxy files through our own authenticated route rather than
// letting pdf.js stream range-requests directly against Storage.
export async function fetchPdfBytes(
  url: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);

  if (!res.body || !onProgress) {
    return new Uint8Array(await res.arrayBuffer());
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
