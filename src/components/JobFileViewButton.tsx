"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Loader2, X } from "lucide-react";

// Sits inside the job card's <Link> (whole card navigates to /track), so the
// click must not bubble. Opens an in-page overlay with the file rendered —
// images via <img>, PDFs page-by-page onto canvases with pdf.js. An <iframe>
// is useless here: Android Chrome has no inline PDF viewer and shows a
// download placeholder instead, so we must rasterize ourselves.
export default function JobFileViewButton({
  fileId,
  fileName,
  mimeType,
}: {
  fileId: string;
  fileName: string;
  mimeType: string | null;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="jobs-file-view-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Eye size={13} aria-hidden="true" /> View
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="file-viewer-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${fileName}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="file-viewer-panel" onClick={(e) => e.stopPropagation()}>
              <div className="file-viewer-head">
                <span className="file-viewer-name" title={fileName}>{fileName}</span>
                <button
                  type="button"
                  className="file-viewer-close"
                  aria-label="Close preview"
                  onClick={() => setOpen(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <FileViewerBody fileId={fileId} fileName={fileName} mimeType={mimeType} />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function FileViewerBody({
  fileId,
  fileName,
  mimeType,
}: {
  fileId: string;
  fileName: string;
  mimeType: string | null;
}) {
  const src = `/api/user/files/${fileId}`;
  const isImage = (mimeType ?? "").startsWith("image/");
  const isPdf = (mimeType ?? "") === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

  if (isImage) {
    return (
      <div className="file-viewer-body">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={fileName} className="file-viewer-img" />
      </div>
    );
  }
  if (isPdf) {
    return <PdfPagesViewer src={src} />;
  }
  // DOC/DOCX before conversion — nothing we can render client-side.
  return (
    <div className="file-viewer-body file-viewer-fallback">
      <p>Preview isn&apos;t available for this file type.</p>
      <a className="btn-secondary" href={src} download={fileName}>Download file</a>
    </div>
  );
}

// Renders every page of the PDF stacked vertically, sized to the container
// width. Fetches once, renders sequentially; fine for typical print jobs.
function PdfPagesViewer({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.arrayBuffer();
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjs.getDocument({ data } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const width = Math.min(container.clientWidth - 16, 860);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= pdf.numPages; i++) {
          if (cancelled) return;
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${width}px`;
          canvas.style.height = `${(viewport.height / dpr).toFixed(0)}px`;
          canvas.className = "file-viewer-page";
          container.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport } as unknown as Parameters<typeof page.render>[0]).promise;
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <div className="file-viewer-body file-viewer-scroll">
      {state === "loading" && (
        <p className="file-viewer-loading">
          <Loader2 size={18} className="spin" aria-hidden="true" /> Loading preview…
        </p>
      )}
      {state === "error" && (
        <p className="file-viewer-loading" role="alert">Could not load the preview. Try again.</p>
      )}
      <div ref={containerRef} className="file-viewer-pages" />
    </div>
  );
}
