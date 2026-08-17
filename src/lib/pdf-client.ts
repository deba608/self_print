"use client";

// Shared pdf.js bootstrap for client-side preview components (PdfCanvasPreview,
// JobFileViewButton, BulkThumb). Keeps the worker path and getDocument options
// in one place so they can't drift between call sites.

export type PdfJsDoc = {
  destroy: () => Promise<void> | void;
  numPages: number;
  getPage: (page: number) => Promise<any>;
};

export async function loadPdfDocument(file: File): Promise<PdfJsDoc> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
  return doc as unknown as PdfJsDoc;
}
