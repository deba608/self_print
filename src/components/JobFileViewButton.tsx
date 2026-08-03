"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, FileText, GalleryHorizontal, GalleryVertical, Loader2, X } from "lucide-react";
import PdfCanvasPreview from "./upload/PdfCanvasPreview";

export type ViewableFile = {
  id: string;
  name: string;
  mimeType: string | null;
};

// Sits inside the job card's <Link> (whole card navigates to /track), so the
// click must not bubble. Opens an in-page overlay with the file rendered —
// images via <img>, PDFs through the same pdf.js pager used on the upload
// form (fast first paint), with a toggle to a continuous scroll view. Bulk
// jobs carry several files; a chip row above the preview switches between
// them (each file is fetched lazily, only when first selected). An <iframe>
// is useless here: Android Chrome has no inline PDF viewer.
export default function JobFileViewButton({ files }: { files: ViewableFile[] }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

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

  if (files.length === 0) return null;
  const active = files[Math.min(activeIdx, files.length - 1)];

  return (
    <>
      <button
        type="button"
        className="jobs-file-view-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setActiveIdx(0);
          setOpen(true);
        }}
      >
        <Eye size={13} aria-hidden="true" /> View{files.length > 1 ? ` (${files.length})` : ""}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="file-viewer-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${active.name}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="file-viewer-panel" onClick={(e) => e.stopPropagation()}>
              {files.length > 1 && (
                <div className="file-viewer-tabs" role="tablist" aria-label="Files in this order">
                  {files.map((f, i) => (
                    <button
                      key={f.id}
                      type="button"
                      role="tab"
                      aria-selected={i === activeIdx}
                      className={`file-viewer-tab ${i === activeIdx ? "is-active" : ""}`}
                      onClick={() => setActiveIdx(i)}
                      title={f.name}
                    >
                      <FileText size={13} aria-hidden="true" />
                      <span className="file-viewer-tab-name">{f.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {/* Keyed by file id so switching files fully resets viewer state. */}
              <FileViewer
                key={active.id}
                fileId={active.id}
                fileName={active.name}
                mimeType={active.mimeType}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function FileViewer({
  fileId,
  fileName,
  mimeType,
  onClose,
}: {
  fileId: string;
  fileName: string;
  mimeType: string | null;
  onClose: () => void;
}) {
  const src = `/api/user/files/${fileId}`;
  const isImage = (mimeType ?? "").startsWith("image/");
  const isPdf = (mimeType ?? "") === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const [mode, setMode] = useState<"page" | "scroll">("page");

  // PdfCanvasPreview wants a File object; fetch the bytes once and share them
  // between both view modes.
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!cancelled) setPdfFile(new File([blob], fileName, { type: "application/pdf" }));
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, fileName, isPdf]);

  return (
    <>
      <div className="file-viewer-head">
        <span className="file-viewer-name" title={fileName}>{fileName}</span>
        <div className="file-viewer-head-actions">
          {isPdf && pdfFile && (
            <button
              type="button"
              className="file-viewer-mode-btn"
              onClick={() => setMode((m) => (m === "page" ? "scroll" : "page"))}
              aria-pressed={mode === "scroll"}
              title={mode === "page" ? "Switch to continuous scroll" : "Switch to page-by-page"}
            >
              {mode === "page" ? (
                <><GalleryVertical size={15} aria-hidden="true" /> Scroll</>
              ) : (
                <><GalleryHorizontal size={15} aria-hidden="true" /> Pages</>
              )}
            </button>
          )}
          <button
            type="button"
            className="file-viewer-close"
            aria-label="Close preview"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {isImage ? (
        <div className="file-viewer-body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={fileName} className="file-viewer-img" />
        </div>
      ) : isPdf ? (
        <div className="file-viewer-body file-viewer-scroll">
          {error ? (
            <p className="file-viewer-loading" role="alert">Could not load the preview. Try again.</p>
          ) : !pdfFile ? (
            <p className="file-viewer-loading">
              <Loader2 size={18} className="spin" aria-hidden="true" /> Loading preview…
            </p>
          ) : mode === "page" ? (
            <PdfCanvasPreview file={pdfFile} fallbackPageCount={1} />
          ) : (
            <PdfScrollViewer file={pdfFile} />
          )}
        </div>
      ) : (
        // DOC/DOCX before conversion — nothing we can render client-side.
        <div className="file-viewer-body file-viewer-fallback">
          <p>Preview isn&apos;t available for this file type.</p>
          <a className="btn-secondary" href={src} download={fileName}>Download file</a>
        </div>
      )}
    </>
  );
}

// Continuous mode: renders every page stacked vertically, sized to the
// container width. The File's bytes are already in memory, so switching
// modes never refetches.
function PdfScrollViewer({ file }: { file: File }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await file.arrayBuffer();
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjs.getDocument({
          data: new Uint8Array(data),
          disableFontFace: true,
          isEvalSupported: false,
          useWorkerFetch: false,
        } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
        if (cancelled) return;
        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const width = Math.min((container.parentElement?.clientWidth ?? 600) - 16, 860);
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
          // First page done — show it while the rest keep rendering.
          if (i === 1 && !cancelled) setState("ready");
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  return (
    <>
      {state === "loading" && (
        <p className="file-viewer-loading">
          <Loader2 size={18} className="spin" aria-hidden="true" /> Rendering pages…
        </p>
      )}
      {state === "error" && (
        <p className="file-viewer-loading" role="alert">Could not render the PDF. Try again.</p>
      )}
      <div ref={containerRef} className="file-viewer-pages" />
    </>
  );
}
