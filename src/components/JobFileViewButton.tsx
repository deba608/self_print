"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Eye,
  FileText,
  FileCode,
  FileImage,
  Layers,
  ScrollText,
  Loader2,
  X,
  Download,
  AlertCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
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
  const [mode, setMode] = useState<"page" | "scroll">("page");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(isPdf);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

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
      {/* Unified Single Header Toolbar */}
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
              {fileIndex} of {totalFiles}
            </span>
          )}
        </div>

        <div className="file-viewer-head-actions">
          {isPdf && pdfFile && (
            <div className="file-viewer-mode-switch" role="group" aria-label="PDF viewing mode">
              <button
                type="button"
                className={`file-viewer-mode-option ${mode === "page" ? "is-active" : ""}`}
                onClick={() => setMode("page")}
                title="Single page view"
              >
                <Layers size={14} aria-hidden="true" />
                <span>Pages</span>
              </button>
              <button
                type="button"
                className={`file-viewer-mode-option ${mode === "scroll" ? "is-active" : ""}`}
                onClick={() => setMode("scroll")}
                title="Continuous vertical scroll"
              >
                <ScrollText size={14} aria-hidden="true" />
                <span>Scroll</span>
              </button>
            </div>
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

      {/* Seamless Single-Layer Content Area */}
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
            <UnifiedPdfViewer file={pdfFile} mode={mode} />
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

// Unified, seamless PDF rendering engine with Page mode and Continuous Scroll mode
function UnifiedPdfViewer({ file, mode }: { file: File; mode: "page" | "scroll" }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<any>(null);

  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>("");
  const [fitMode, setFitMode] = useState<"width" | "page">("width");
  const [loadingDoc, setLoadingDoc] = useState<boolean>(true);
  const [docError, setDocError] = useState<boolean>(false);
  const [renderedCount, setRenderedCount] = useState<number>(0);

  // Load PDF Document
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
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage(1);
      } catch (err) {
        if (!cancelled) setDocError(true);
      } finally {
        if (!cancelled) setLoadingDoc(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  // Keyboard navigation for page view
  useEffect(() => {
    if (mode !== "page") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setCurrentPage((p) => Math.max(1, p - 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " ") {
        setCurrentPage((p) => Math.min(numPages, p + 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, numPages]);

  // Render Single Page Mode
  useEffect(() => {
    if (!pdfDoc || mode !== "page") return;
    let cancelled = false;

    async function renderSinglePage() {
      try {
        renderTaskRef.current?.cancel();
        const page = await pdfDoc.getPage(currentPage);
        if (cancelled) return;

        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const containerW = Math.max(container.clientWidth - 32, 200);
        const containerH = Math.max(container.clientHeight - 88, 240);
        const unscaledVp = page.getViewport({ scale: 1 });

        let scale = containerW / unscaledVp.width;
        if (fitMode === "page") {
          const scaleH = containerH / unscaledVp.height;
          scale = Math.min(scale, scaleH);
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const vp = page.getViewport({ scale: scale * dpr });

        const drawW = unscaledVp.width * scale;
        const drawH = unscaledVp.height * scale;

        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${Math.floor(drawW)}px`;
        canvas.style.maxWidth = "100%";
        canvas.style.height = `${Math.floor(drawH)}px`;

        const renderTask = page.render({ canvasContext: ctx, viewport: vp });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException") {
          console.error("Single page render error:", err);
        }
      }
    }

    renderSinglePage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pdfDoc, currentPage, mode, fitMode]);

  // Render Continuous Scroll Mode
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!pdfDoc || mode !== "scroll") return;
    let cancelled = false;

    async function renderAllPages() {
      const container = scrollContainerRef.current;
      if (!container) return;
      container.innerHTML = "";
      setRenderedCount(0);

      const parentW = container.clientWidth || 600;
      const width = Math.max(Math.min(parentW - 32, 820), 220);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (cancelled) return;
        const page = await pdfDoc.getPage(i);
        const unscaled = page.getViewport({ scale: 1 });
        const scale = width / unscaled.width;
        const vp = page.getViewport({ scale: scale * dpr });

        const card = document.createElement("div");
        card.className = "unified-pdf-page-card";

        const badge = document.createElement("div");
        badge.className = "unified-pdf-page-badge";
        badge.textContent = `Page ${i} of ${pdfDoc.numPages}`;
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
    }

    renderAllPages();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, mode]);

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
    <div className="unified-pdf-container" ref={containerRef}>
      {mode === "page" ? (
        <div className="unified-pdf-page-stage">
          <canvas ref={canvasRef} className="unified-pdf-single-canvas" />

          {/* Floating Navigation Controls */}
          {numPages > 1 && (
            <div className="unified-pdf-float-bar">
              <button
                type="button"
                className="unified-pdf-nav-btn"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                aria-label="Previous Page"
                title="Previous Page (Left Arrow)"
              >
                <ChevronLeft size={18} />
              </button>

              <div className="unified-pdf-page-jump">
                <span>Page</span>
                <input
                  type="number"
                  min={1}
                  max={numPages}
                  value={pageInput}
                  placeholder={String(currentPage)}
                  onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const num = parseInt(pageInput, 10);
                      if (num >= 1 && num <= numPages) {
                        setCurrentPage(num);
                        setPageInput("");
                      }
                    }
                  }}
                  onBlur={() => {
                    const num = parseInt(pageInput, 10);
                    if (num >= 1 && num <= numPages) {
                      setCurrentPage(num);
                    }
                    setPageInput("");
                  }}
                  aria-label="Jump to page"
                  className="unified-pdf-page-input"
                />
                <span>of {numPages}</span>
              </div>

              <button
                type="button"
                className="unified-pdf-nav-btn"
                disabled={currentPage >= numPages}
                onClick={() => setCurrentPage((p) => Math.min(numPages, p + 1))}
                aria-label="Next Page"
                title="Next Page (Right Arrow)"
              >
                <ChevronRight size={18} />
              </button>

              <div className="unified-pdf-divider" />

              <button
                type="button"
                className={`unified-pdf-fit-btn ${fitMode === "page" ? "is-active" : ""}`}
                onClick={() => setFitMode((m) => (m === "width" ? "page" : "width"))}
                title={fitMode === "width" ? "Fit whole page to screen" : "Fit to width"}
                aria-label={fitMode === "width" ? "Fit whole page to screen" : "Fit to width"}
              >
                {fitMode === "width" ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="unified-pdf-scroll-stage">
          <div ref={scrollContainerRef} className="unified-pdf-scroll-list" />

          {/* Floating page count status */}
          <div className="unified-pdf-float-status">
            <ScrollText size={14} aria-hidden="true" />
            <span>
              {renderedCount > 0 && renderedCount < numPages
                ? `Loading page ${renderedCount} of ${numPages}…`
                : `${numPages} ${numPages === 1 ? "page" : "pages"}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
