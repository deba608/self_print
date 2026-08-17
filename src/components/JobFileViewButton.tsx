"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadPdfDocument, type PdfJsDoc } from "@/lib/pdf-client";
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

  // Keep the loaded doc in a ref so fitMode changes can re-render without re-loading
  const pdfDocRef = useRef<PdfJsDoc | null>(null);
  const renderAbortRef = useRef<{ cancelled: boolean; tasks: Set<{ cancel: () => void }> }>({
    cancelled: false,
    tasks: new Set(),
  });

  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState(false);
  const [numPages, setNumPages] = useState(1);
  const [renderedCount, setRenderedCount] = useState(0);
  const [activePageInternal, setActivePageInternal] = useState(1);

  // -- Lay out placeholders for every page, then render only pages near the
  // viewport as the user scrolls (instead of blocking on every page up front).
  // Cuts first-paint time on long documents from "wait for all N pages" to
  // "wait for the ~2 pages currently visible". --
  const renderPages = async (
    doc: PdfJsDoc,
    abort: { cancelled: boolean; tasks: Set<{ cancel: () => void }> }
  ) => {
    const container = scrollContainerRef.current;
    const stage = scrollStageRef.current;
    if (!container || !stage) return;

    container.innerHTML = "";
    setRenderedCount(0);
    setActivePageInternal(1);
    onActivePageChange(1);

    const parentW = stage.clientWidth || 600;
    const parentH = stage.clientHeight || 700;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Phase 1: build sized placeholder cards for every page (metadata only,
    // no rasterizing) so the scroll stage has correct height/layout instantly
    // and nothing jumps around as pages render in.
    const canvasByPage = new Map<number, HTMLCanvasElement>();
    const vpByPage = new Map<number, any>();

    try {
      for (let i = 1; i <= doc.numPages; i++) {
        if (abort.cancelled) return;
        const page = await doc.getPage(i);
        const unscaled = page.getViewport({ scale: 1 });

        // Fit width: cap to a comfortable reading width. Fit page: derive width
        // from the page's own aspect ratio so it fits the available height,
        // rather than guessing with a fixed multiplier.
        let width = Math.max(Math.min(parentW - 32, 860), 220);
        if (fitMode === "page") {
          const maxH = Math.max(parentH - 48, 160);
          const aspect = unscaled.width / unscaled.height;
          width = Math.max(Math.min(parentW - 48, maxH * aspect), 220);
        }

        const scale = (width / unscaled.width) * dpr;
        const vp = page.getViewport({ scale });
        vpByPage.set(i, vp);

        const card = document.createElement("div");
        card.className = "unified-pdf-page-card is-pending";
        card.setAttribute("data-page-num", String(i));

        const badge = document.createElement("div");
        badge.className = "unified-pdf-page-badge";
        badge.textContent = `Page ${i} / ${doc.numPages}`;
        card.appendChild(badge);

        const canvas = document.createElement("canvas");
        canvas.style.width = `${width}px`;
        canvas.style.maxWidth = "100%";
        canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
        canvas.className = "unified-pdf-canvas";
        card.appendChild(canvas);
        container.appendChild(card);
        canvasByPage.set(i, canvas);
      }
    } catch (err: any) {
      if (!abort.cancelled) setDocError(true);
      return;
    }
    if (abort.cancelled) return;

    // Phase 2: render pages on demand, closest-to-viewport first, with a
    // small render concurrency so pdf.js can overlap page decode/paint work.
    const rendered = new Set<number>();
    const queued = new Set<number>();
    const queue: number[] = [];
    let active = 0;
    const MAX_CONCURRENT = 2;

    const renderOne = async (pageNum: number) => {
      if (abort.cancelled || rendered.has(pageNum)) return;
      const canvas = canvasByPage.get(pageNum);
      const vp = vpByPage.get(pageNum);
      if (!canvas || !vp) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      try {
        const page = await doc.getPage(pageNum);
        if (abort.cancelled) return;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const task = page.render({ canvasContext: ctx, viewport: vp } as any);
        abort.tasks.add(task);
        await task.promise;
        abort.tasks.delete(task);
        if (abort.cancelled) return;
        rendered.add(pageNum);
        canvas.closest(".unified-pdf-page-card")?.classList.remove("is-pending");
        canvas.closest(".unified-pdf-page-card")?.classList.add("is-rendered");
        setRenderedCount(rendered.size);
      } catch (err: any) {
        if (!abort.cancelled && err?.name !== "RenderingCancelledException") {
          // Leave this single page blank rather than failing the whole viewer.
        }
      }
    };

    const pump = () => {
      while (active < MAX_CONCURRENT && queue.length && !abort.cancelled) {
        const n = queue.shift()!;
        queued.delete(n);
        active++;
        renderOne(n).finally(() => {
          active--;
          pump();
        });
      }
    };

    const schedule = (pageNum: number, priority = false) => {
      if (rendered.has(pageNum) || queued.has(pageNum) || abort.cancelled) return;
      queued.add(pageNum);
      if (priority) queue.unshift(pageNum);
      else queue.push(pageNum);
      pump();
    };

    // Render the first couple of pages immediately (what's visible on open).
    schedule(1, true);
    if (doc.numPages > 1) schedule(2, true);

    const cards = container.querySelectorAll(".unified-pdf-page-card");
    (container as any).__observer?.disconnect();
    const observer = new IntersectionObserver(
      (entries) => {
        let best: { num: number; ratio: number } = { num: activePageInternal, ratio: -1 };
        for (const entry of entries) {
          const n = parseInt(entry.target.getAttribute("data-page-num") || "1", 10);
          if (entry.isIntersecting) schedule(n, true);
          if (entry.intersectionRatio > best.ratio) best = { num: n, ratio: entry.intersectionRatio };
        }
        if (best.ratio > 0) {
          setActivePageInternal(best.num);
          onActivePageChange(best.num);
        }
      },
      {
        root: scrollStageRef.current, // ← the actual scrollable element
        rootMargin: "800px 0px", // pre-render pages just before they scroll into view
        threshold: [0, 0.25, 0.5, 0.75, 1.0],
      }
    );
    cards.forEach((c) => observer.observe(c));
    (container as any).__observer = observer;
  };

  // -- Load PDF doc (only when file changes) --
  useEffect(() => {
    let cancelled = false;
    setLoadingDoc(true);
    setDocError(false);

    (async () => {
      try {
        // Destroy previous doc
        await pdfDocRef.current?.destroy?.();
        pdfDocRef.current = null;

        const doc = await loadPdfDocument(file);

        if (cancelled) { await doc.destroy(); return; }
        if (!doc.numPages || doc.numPages < 1) {
          await doc.destroy();
          setDocError(true);
          setLoadingDoc(false);
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        onTotalPagesChange(doc.numPages);
        // Rendering starts from the effect below once the scroll container has
        // actually mounted — calling renderPages here would run before React
        // swaps the loading spinner for the container, see null refs, and
        // silently leave the viewer blank.
        setLoadingDoc(false);
      } catch {
        if (!cancelled) {
          setDocError(true);
          setLoadingDoc(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderAbortRef.current.cancelled = true;
      renderAbortRef.current.tasks.forEach((t) => t.cancel());
      const doc = pdfDocRef.current;
      pdfDocRef.current = null;
      void doc?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // -- Re-render on fitMode change WITHOUT reloading the file --
  useEffect(() => {
    const doc = pdfDocRef.current;
    if (!doc) return; // doc not loaded yet, first load will handle it

    const abort: { cancelled: boolean; tasks: Set<{ cancel: () => void }> } = {
      cancelled: false,
      tasks: new Set(),
    };
    renderAbortRef.current.cancelled = true;
    renderAbortRef.current.tasks.forEach((t) => t.cancel());
    renderAbortRef.current = abort;
    renderPages(doc, abort).catch(() => {
      if (!abort.cancelled) setDocError(true);
    });

    return () => {
      abort.cancelled = true;
      abort.tasks.forEach((t) => t.cancel());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode]);



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
            {renderedCount < numPages
              ? `${activePageInternal} / ${numPages} · rendering…`
              : `${activePageInternal} / ${numPages} pages`}
          </span>
        </div>
      </div>
    </div>
  );
}
