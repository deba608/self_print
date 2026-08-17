"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Eye,
  FileText,
  FileCode,
  FileImage,
  Loader2,
  X,
  Download,
  AlertCircle,
  RotateCcw,
  Maximize2,
  Minimize2,
} from "lucide-react";

export type ViewableFile = {
  id: string;
  name: string;
  mimeType: string | null;
};

interface JobFileViewButtonProps {
  files: ViewableFile[];
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
  variant?: "primary" | "secondary" | "chip";
  className?: string;
}

export default function JobFileViewButton({
  files,
  label,
  disabled = false,
  disabledReason,
  variant = "chip",
  className = "",
}: JobFileViewButtonProps) {
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

  if (files.length === 0 && !disabled) return null;

  const active = files[Math.min(activeIdx, Math.max(0, files.length - 1))];

  const buttonContent = (
    <>
      <Eye size={14} aria-hidden="true" className="jobs-btn-icon" />
      <span>{label ?? (files.length > 1 ? `View Files (${files.length})` : "View PDF")}</span>
    </>
  );

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={disabled ? (disabledReason ?? "File preview unavailable") : "Preview file"}
        className={`jobs-file-view-btn ${variant === "primary" ? "btn-variant-primary" : variant === "secondary" ? "btn-variant-secondary" : ""} ${className}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          setActiveIdx(0);
          setOpen(true);
        }}
      >
        {buttonContent}
      </button>

      {open &&
        active &&
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
              {/* Multi-file tab bar */}
              {files.length > 1 && (
                <div className="file-viewer-tabs" role="tablist" aria-label="Files in this print order">
                  {files.map((f, i) => {
                    const isPdf = (f.mimeType ?? "").includes("pdf") || f.name.toLowerCase().endsWith(".pdf");
                    const isImg = (f.mimeType ?? "").startsWith("image/");
                    return (
                      <button
                        key={f.id}
                        type="button"
                        role="tab"
                        aria-selected={i === activeIdx}
                        className={`file-viewer-tab ${i === activeIdx ? "is-active" : ""}`}
                        onClick={() => setActiveIdx(i)}
                        title={f.name}
                      >
                        {isPdf ? (
                          <FileText size={14} aria-hidden="true" />
                        ) : isImg ? (
                          <FileImage size={14} aria-hidden="true" />
                        ) : (
                          <FileCode size={14} aria-hidden="true" />
                        )}
                        <span className="file-viewer-tab-name">{f.name}</span>
                        <span className="file-viewer-tab-idx">#{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Seamless viewer component keyed by file id */}
              <FileViewer
                key={active.id}
                fileId={active.id}
                fileName={active.name}
                mimeType={active.mimeType}
                fileIndex={activeIdx + 1}
                totalFiles={files.length}
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
  fileIndex,
  totalFiles,
  onClose,
}: {
  fileId: string;
  fileName: string;
  mimeType: string | null;
  fileIndex: number;
  totalFiles: number;
  onClose: () => void;
}) {
  const src = `/api/user/files/${fileId}`;
  const isImage = (mimeType ?? "").startsWith("image/");
  const isPdf = (mimeType ?? "") === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(isPdf);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Shared fit mode & active page state
  const [fitMode, setFitMode] = useState<"width" | "page">("width");
  const [activePage, setActivePage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    setLoading(true);
    setError(false);

    (async () => {
      try {
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!cancelled) {
          setPdfFile(new File([blob], fileName, { type: "application/pdf" }));
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [src, fileName, isPdf, retryKey]);

  return (
    <>
      {/* Minimal Unified Header with 1/10 Counter and 2-in-1 Fit Button */}
      <div className="file-viewer-head">
        <div className="file-viewer-title-group">
          <div className="file-viewer-type-pill">
            {isPdf ? "PDF" : isImage ? "IMAGE" : "DOC"}
          </div>
          <span className="file-viewer-name" title={fileName}>
            {fileName}
          </span>
          {totalFiles > 1 && (
            <span className="file-viewer-file-count-badge">
              File {fileIndex} of {totalFiles}
            </span>
          )}
        </div>

        <div className="file-viewer-head-actions">
          {/* 1 / 10 Page Numbering Badge */}
          {isPdf && pdfFile && totalPages > 0 && (
            <div className="file-viewer-page-counter" aria-label="Page counter">
              <FileText size={13} aria-hidden="true" />
              <span>Page</span>
              <strong>{activePage}</strong>
              <span className="file-viewer-page-sep">/</span>
              <span>{totalPages}</span>
            </div>
          )}

          {/* 2-in-1 Animated Fit Toggle */}
          {isPdf && pdfFile && (
            <button
              type="button"
              className={`pdfjs-fit-toggle-btn ${fitMode === "page" ? "is-fit-page" : "is-fit-width"}`}
              onClick={() => setFitMode((m) => (m === "width" ? "page" : "width"))}
              title={fitMode === "width" ? "Switch to Fit Page" : "Switch to Fit Width"}
              aria-label={fitMode === "width" ? "Switch to Fit Page" : "Switch to Fit Width"}
            >
              <span className="pdfjs-fit-icon-wrap" aria-hidden="true">
                <Maximize2 className="pdfjs-fit-icon fit-width-icon" size={15} />
                <Minimize2 className="pdfjs-fit-icon fit-page-icon" size={15} />
              </span>
              <span className="pdfjs-fit-label file-viewer-btn-text">
                {fitMode === "width" ? "Fit Width" : "Fit Page"}
              </span>
            </button>
          )}

          <a
            href={src}
            download={fileName}
            className="file-viewer-action-btn file-viewer-download"
            title="Download original file"
            aria-label="Download original file"
          >
            <Download size={15} aria-hidden="true" />
            <span className="file-viewer-btn-text">Download</span>
          </a>

          <button
            type="button"
            className="file-viewer-close"
            aria-label="Close preview (Esc)"
            title="Close (Esc)"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Content Area */}
      {isImage ? (
        <div className="file-viewer-body file-viewer-img-stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={fileName} className="file-viewer-img" />
        </div>
      ) : isPdf ? (
        <div className="file-viewer-body file-viewer-pdf-stage">
          {error ? (
            <div className="file-viewer-error-state" role="alert">
              <AlertCircle size={36} className="file-viewer-error-icon" aria-hidden="true" />
              <p className="file-viewer-error-title">Could not load preview</p>
              <p className="file-viewer-error-desc">
                The file may have expired or is unavailable right now.
              </p>
              <div className="file-viewer-error-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setRetryKey((k) => k + 1)}
                >
                  <RotateCcw size={14} aria-hidden="true" /> Retry
                </button>
                <a className="btn-primary" href={src} download={fileName}>
                  <Download size={14} aria-hidden="true" /> Download File
                </a>
              </div>
            </div>
          ) : loading || !pdfFile ? (
            <div className="file-viewer-loading-state">
              <Loader2 size={24} className="spin file-viewer-loader-icon" aria-hidden="true" />
              <span>Rendering PDF document…</span>
            </div>
          ) : (
            <PdfScrollViewer
              file={pdfFile}
              fitMode={fitMode}
              onActivePageChange={setActivePage}
              onTotalPagesChange={setTotalPages}
            />
          )}
        </div>
      ) : (
        // Non-PDF documents before conversion
        <div className="file-viewer-body file-viewer-fallback">
          <FileText size={42} aria-hidden="true" className="file-viewer-fallback-icon" />
          <p className="file-viewer-fallback-title">Document Preview</p>
          <p className="file-viewer-fallback-desc">
            Inline preview is not available for this format. You can download the file to view it.
          </p>
          <a className="btn-primary" href={src} download={fileName}>
            <Download size={15} aria-hidden="true" /> Download {fileName}
          </a>
        </div>
      )}
    </>
  );
}

// Continuous vertical scroll viewer for PDF with dynamic page tracking
function PdfScrollViewer({
  file,
  fitMode,
  onActivePageChange,
  onTotalPagesChange,
}: {
  file: File;
  fitMode: "width" | "page";
  onActivePageChange: (p: number) => void;
  onTotalPagesChange: (t: number) => void;
}) {
  const scrollStageRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState(false);
  const [numPages, setNumPages] = useState(1);
  const [renderedCount, setRenderedCount] = useState(0);
  const [activePageInternal, setActivePageInternal] = useState(1);

  // Set up intersection observer to detect current visible page
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || numPages <= 1) return;

    const cards = container.querySelectorAll(".unified-pdf-page-card");
    if (!cards.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.getAttribute("data-page-num") || "1", 10);
            if (Number.isFinite(pageNum)) {
              setActivePageInternal(pageNum);
              onActivePageChange(pageNum);
            }
          }
        }
      },
      {
        root: scrollStageRef.current,
        threshold: 0.35,
      }
    );

    cards.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [renderedCount, numPages, onActivePageChange]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDoc(true);
    setDocError(false);

    (async () => {
      try {
        const data = await file.arrayBuffer();
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({
          data: new Uint8Array(data),
          disableFontFace: true,
          isEvalSupported: false,
          useWorkerFetch: false,
        } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;

        if (cancelled) return;
        setNumPages(doc.numPages);
        onTotalPagesChange(doc.numPages);
        setLoadingDoc(false);

        const container = scrollContainerRef.current;
        const stage = scrollStageRef.current;
        if (!container || !stage) return;
        container.innerHTML = "";
        setRenderedCount(0);
        setActivePageInternal(1);
        onActivePageChange(1);

        const parentW = stage.clientWidth || 600;
        const parentH = stage.clientHeight || 700;

        let width = Math.max(Math.min(parentW - 32, 860), 220);
        if (fitMode === "page") {
          width = Math.max(Math.min(parentW - 48, (parentH - 90) * 0.72), 220);
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const unscaled = page.getViewport({ scale: 1 });
          const scale = width / unscaled.width;
          const vp = page.getViewport({ scale: scale * dpr });

          const card = document.createElement("div");
          card.className = "unified-pdf-page-card";
          card.setAttribute("data-page-num", String(i));

          const badge = document.createElement("div");
          badge.className = "unified-pdf-page-badge";
          badge.textContent = `Page ${i} / ${doc.numPages}`;
          card.appendChild(badge);

          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = `${width}px`;
          canvas.style.maxWidth = "100%";
          canvas.style.height = `${(vp.height / dpr).toFixed(0)}px`;
          canvas.className = "unified-pdf-canvas";
          card.appendChild(canvas);

          container.appendChild(card);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport: vp } as any).promise;

          if (!cancelled) {
            setRenderedCount(i);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setDocError(true);
          setLoadingDoc(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file, fitMode, onActivePageChange, onTotalPagesChange]);

  if (loadingDoc) {
    return (
      <div className="file-viewer-loading-state">
        <Loader2 size={24} className="spin file-viewer-loader-icon" aria-hidden="true" />
        <span>Loading PDF pages…</span>
      </div>
    );
  }

  if (docError) {
    return (
      <div className="file-viewer-error-state" role="alert">
        <AlertCircle size={32} className="file-viewer-error-icon" aria-hidden="true" />
        <p className="file-viewer-error-title">Could not load PDF document</p>
      </div>
    );
  }

  return (
    <div className="unified-pdf-container">
      <div className="unified-pdf-scroll-stage" ref={scrollStageRef}>
        <div ref={scrollContainerRef} className="unified-pdf-scroll-list" />

        {/* Floating page count status pill */}
        <div className="unified-pdf-float-status">
          <FileText size={14} aria-hidden="true" />
          <span>
            {renderedCount > 0 && renderedCount < numPages
              ? `Loading page ${renderedCount} / ${numPages}…`
              : `${activePageInternal} / ${numPages} pages`}
          </span>
        </div>
      </div>
    </div>
  );
}
