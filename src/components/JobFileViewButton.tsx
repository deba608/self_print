"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Loader2, X } from "lucide-react";
import PdfCanvasPreview from "./upload/PdfCanvasPreview";

// Sits inside the job card's <Link> (whole card navigates to /track), so the
// click must not bubble. Opens an in-page overlay with the file rendered —
// images via <img>, PDFs through the same pdf.js pager used on the upload
// form (renders one page at a time, so first paint is fast). An <iframe> is
// useless here: Android Chrome has no inline PDF viewer.
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

  // PdfCanvasPreview wants a File object; fetch the bytes once and wrap them.
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

  if (isImage) {
    return (
      <div className="file-viewer-body">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={fileName} className="file-viewer-img" />
      </div>
    );
  }
  if (isPdf) {
    return (
      <div className="file-viewer-body file-viewer-scroll">
        {error ? (
          <p className="file-viewer-loading" role="alert">Could not load the preview. Try again.</p>
        ) : pdfFile ? (
          <PdfCanvasPreview file={pdfFile} fallbackPageCount={1} />
        ) : (
          <p className="file-viewer-loading">
            <Loader2 size={18} className="spin" aria-hidden="true" /> Loading preview…
          </p>
        )}
      </div>
    );
  }
  // DOC/DOCX before conversion — nothing we can render client-side.
  return (
    <div className="file-viewer-body file-viewer-fallback">
      <p>Preview isn&apos;t available for this file type.</p>
      <a className="btn-secondary" href={src} download={fileName}>Download file</a>
    </div>
  );
}
