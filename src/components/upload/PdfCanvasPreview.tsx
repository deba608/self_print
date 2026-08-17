"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Maximize2, Minimize2 } from "lucide-react";

// Paper dimensions in mm, portrait width × height. Landscape swaps them.
const PAPER_MM: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  B5: [176, 250],
  Letter: [216, 279],
  Legal: [216, 356],
  Photo: [102, 152],
};

// What the print helper does with margins, mirrored for the preview:
// default ≈ driver margins, minimum = 0.25in, none = 0.
const MARGIN_FRACTION: Record<string, number> = { default: 0.05, minimum: 0.02, none: 0 };

export type PreviewSim = {
  pagesPerSheet: number;
  layout: string; // portrait | landscape
  paperSize: string; // A3..Photo
  margins: string; // default | minimum | none
  pages?: number[] | null; // 1-based page numbers to include; null/absent = all
};

export default function PdfCanvasPreview({
  file,
  fallbackPageCount,
  sim,
}: {
  file: File;
  fallbackPageCount: number;
  sim?: PreviewSim;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<{
    destroy: () => Promise<void> | void;
    numPages: number;
    getPage: (page: number) => Promise<any>;
  } | null>(null);

  const [pageCount, setPageCount] = useState(fallbackPageCount);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scrollRenderedCount, setScrollRenderedCount] = useState(0);
  const [activeSheet, setActiveSheet] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "page">("width");

  useEffect(() => {
    let disposed = false;

    async function loadPdf() {
      setLoading(true);
      setError("");
      try {
        await pdfRef.current?.destroy?.();
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const data = await file.arrayBuffer();
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const documentParams = {
          data: new Uint8Array(data),
          disableFontFace: true,
          isEvalSupported: false,
          useWorkerFetch: false,
        } as unknown as Parameters<typeof pdfjs.getDocument>[0];
        const pdf = await pdfjs.getDocument(documentParams).promise;
        if (disposed) {
          await pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setPdfVersion((version) => version + 1);
      } catch {
        if (!disposed) setError("Unable to render PDF preview on this device.");
      } finally {
        if (!disposed && !pdfRef.current) setLoading(false);
      }
    }

    loadPdf();

    return () => {
      disposed = true;
      pdfRef.current?.destroy?.();
      pdfRef.current = null;
    };
  }, [file]);

  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Listen to container resizing (mount, layout changes, device rotation, scrollbar toggles)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const style = window.getComputedStyle(el);
      const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const availableW = Math.max(0, el.clientWidth - padX);
      const availableH = Math.max(0, el.clientHeight - padY);
      setContainerSize((prev) => {
        if (Math.abs(prev.width - availableW) < 1 && Math.abs(prev.height - availableH) < 1) {
          return prev;
        }
        return { width: availableW, height: availableH };
      });
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(el);
      return () => observer.disconnect();
    } else {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
  }, []);

  // Pages-per-sheet grid: same layout math as agent/print-image.ps1 — cols is
  // the ceiling square root, pages fill row-major, each page fits its cell.
  const pps = Math.max(1, sim?.pagesPerSheet ?? 1);

  // Page-range selection: only the chosen pages appear on preview sheets, in
  // the same order the agent prints them. Key ties the render effect to the
  // selection without array-identity churn.
  const pagesKey = sim?.pages?.join(",") ?? "";
  const pageList = useMemo(() => {
    const selected = (sim?.pages ?? []).filter((p) => p >= 1 && p <= pageCount);
    return selected.length ? selected : Array.from({ length: pageCount }, (_, i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesKey, pageCount]);
  const sheetCount = Math.max(1, Math.ceil(pageList.length / pps));

  // Intersection observer to track current visible sheet
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || sheetCount <= 1) return;

    const cards = container.querySelectorAll(".pdfjs-scroll-sheet-card");
    if (!cards.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = parseInt(entry.target.getAttribute("data-sheet-idx") || "1", 10);
            if (Number.isFinite(idx)) {
              setActiveSheet(idx);
            }
          }
        }
      },
      {
        root: containerRef.current,
        threshold: 0.4,
      }
    );

    cards.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [scrollRenderedCount, sheetCount]);

  // Render Continuous Scroll View (Default & Only Mode)
  useEffect(() => {
    if (!pdfRef.current) return;
    let disposed = false;

    async function renderAllSheets() {
      const pdf = pdfRef.current;
      const container = scrollContainerRef.current;
      if (!container || !pdf) return;
      container.innerHTML = "";
      setLoading(true);
      setScrollRenderedCount(0);
      setActiveSheet(1);

      try {
        const wrap = containerRef.current;
        let availableW = containerSize.width;
        let availableH = containerSize.height;

        if ((!availableW || availableW <= 0) && wrap) {
          const style = window.getComputedStyle(wrap);
          const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
          availableW = Math.max(wrap.clientWidth - padX, 100);
        }
        if ((!availableH || availableH <= 0) && wrap) {
          const style = window.getComputedStyle(wrap);
          const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
          availableH = Math.max(wrap.clientHeight - padY, 200);
        }

        const containerWidth = Math.max(availableW || 300, 100);
        const containerHeight = Math.max(availableH || 400, 200);

        let [mmW, mmH] = PAPER_MM[sim?.paperSize ?? "A4"] ?? PAPER_MM.A4;
        if (sim?.layout === "landscape") [mmW, mmH] = [mmH, mmW];

        let sheetW = containerWidth;
        let sheetH = (sheetW * mmH) / mmW;

        if (fitMode === "page" && sheetH > containerHeight) {
          sheetH = containerHeight;
          sheetW = (sheetH * mmW) / mmH;
        }

        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

        const marginPx = sheetW * (MARGIN_FRACTION[sim?.margins ?? "default"] ?? 0.05);
        const areaX = marginPx,
          areaY = marginPx;
        const areaW = sheetW - 2 * marginPx,
          areaH = sheetH - 2 * marginPx;

        const cols = Math.ceil(Math.sqrt(pps));
        const rows = Math.ceil(pps / cols);
        const cellW = areaW / cols,
          cellH = areaH / rows;

        for (let s = 1; s <= sheetCount; s++) {
          if (disposed) return;

          const card = document.createElement("div");
          card.className = "pdfjs-scroll-sheet-card";
          card.setAttribute("data-sheet-idx", String(s));

          const badge = document.createElement("div");
          badge.className = "pdfjs-scroll-sheet-badge";
          badge.textContent = pps > 1 ? `Sheet ${s} / ${sheetCount}` : `Page ${s} / ${sheetCount}`;
          card.appendChild(badge);

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(sheetW * pixelRatio);
          canvas.height = Math.floor(sheetH * pixelRatio);
          canvas.style.width = `${Math.floor(sheetW)}px`;
          canvas.style.maxWidth = "100%";
          canvas.style.height = `${Math.floor(sheetH)}px`;
          canvas.className = "pdfjs-canvas";
          card.appendChild(canvas);

          container.appendChild(card);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, sheetW, sheetH);

          const firstIdx = (s - 1) * pps;
          for (let n = 0; n < pps; n++) {
            const pageIdx = pageList[firstIdx + n];
            if (!pageIdx) break;
            const page = await pdf.getPage(pageIdx);
            if (disposed) return;

            const vp1 = page.getViewport({ scale: 1 });
            const fit = Math.min(cellW / vp1.width, cellH / vp1.height);
            const vp = page.getViewport({ scale: Math.max(0.1, fit) * pixelRatio });

            const off = document.createElement("canvas");
            off.width = Math.max(1, Math.floor(vp.width));
            off.height = Math.max(1, Math.floor(vp.height));
            const offCtx = off.getContext("2d");
            if (!offCtx) continue;

            const renderTask = page.render({ canvasContext: offCtx, viewport: vp });
            await renderTask.promise;
            if (disposed) return;

            const drawW = vp.width / pixelRatio,
              drawH = vp.height / pixelRatio;
            const col = n % cols,
              row = Math.floor(n / cols);
            const x = areaX + col * cellW + (cellW - drawW) / 2;
            const y = areaY + row * cellH + (cellH - drawH) / 2;
            ctx.drawImage(off, x, y, drawW, drawH);
            if (pps > 1) {
              ctx.strokeStyle = "rgba(0,0,0,0.12)";
              ctx.strokeRect(x, y, drawW, drawH);
            }
          }

          if (!disposed) {
            setScrollRenderedCount(s);
          }
        }
      } catch (err) {
        if (!disposed && !(err instanceof Error && err.name === "RenderingCancelledException")) {
          setError("Unable to render scroll view.");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    renderAllSheets();

    return () => {
      disposed = true;
    };
  }, [
    pdfVersion,
    fitMode,
    pps,
    sim?.layout,
    sim?.paperSize,
    sim?.margins,
    sheetCount,
    pageList,
    containerSize.width,
    containerSize.height,
  ]);

  if (error) {
    return (
      <div className="pdf-preview-fallback">
        <div className="fallback-icon">
          <FileText size={28} aria-hidden="true" />
        </div>
        <p>{error}</p>
        <span className="file-info">{file.name}</span>
        <span className="mobile-hint">The file will still be uploaded for printing.</span>
      </div>
    );
  }

  return (
    <div className="pdfjs-preview">
      {/* Clean Toolbar with 1/10 Page Numbering and 2-in-1 Animated Fit Toggle */}
      <div className="pdfjs-toolbar">
        {/* Page Numbering: 1 / 10 */}
        <div className="pdfjs-page-counter-badge" aria-label="Page counter">
          <FileText size={14} className="pdfjs-page-counter-icon" aria-hidden="true" />
          <span className="pdfjs-page-counter-text">
            {pps > 1 ? "Sheet" : "Page"}
          </span>
          <span className="pdfjs-page-counter-numbers">
            <strong className="pdfjs-page-counter-active">{activeSheet}</strong>
            <span className="pdfjs-page-counter-sep">/</span>
            <span className="pdfjs-page-counter-total">{sheetCount}</span>
          </span>
        </div>

        {/* 2-in-1 Animated Fit Toggle Button */}
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
          <span className="pdfjs-fit-label">
            {fitMode === "width" ? "Fit Width" : "Fit Page"}
          </span>
        </button>
      </div>

      <div className="pdfjs-canvas-wrap" ref={containerRef}>
        {loading ? (
          <div className="pdfjs-loading">
            <Loader2 size={20} className="spin" />
            Rendering preview...
          </div>
        ) : null}

        <div ref={scrollContainerRef} className="pdfjs-scroll-container" />
      </div>
    </div>
  );
}
