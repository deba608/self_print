"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileText, Loader2, Maximize2, Minimize2 } from "lucide-react";

// Paper dimensions in mm, portrait width × height. Landscape swaps them.
const PAPER_MM: Record<string, [number, number]> = {
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
  B5: [176, 250], Letter: [216, 279], Legal: [216, 356], Photo: [102, 152],
};

// What the print helper does with margins, mirrored for the preview:
// default ≈ driver margins, minimum = 0.25in, none = 0.
const MARGIN_FRACTION: Record<string, number> = { default: 0.05, minimum: 0.02, none: 0 };

export type PreviewSim = {
  pagesPerSheet: number;
  layout: string;      // portrait | landscape
  paperSize: string;   // A3..Photo
  margins: string;     // default | minimum | none
  pages?: number[] | null; // 1-based page numbers to include; null/absent = all
};

export default function PdfCanvasPreview({ file, fallbackPageCount, sim }: { file: File; fallbackPageCount: number; sim?: PreviewSim }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const pdfRef = useRef<{ destroy: () => Promise<void> | void; numPages: number; getPage: (page: number) => Promise<any> } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [pageCount, setPageCount] = useState(fallbackPageCount);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [fitMode, setFitMode] = useState<"page" | "width">("width");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;

    async function loadPdf() {
      setLoading(true);
      setError("");
      setPageNumber(1);
      setPageInput("");
      try {
        renderTaskRef.current?.cancel();
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
      renderTaskRef.current?.cancel();
      pdfRef.current?.destroy?.();
      renderTaskRef.current = null;
      pdfRef.current = null;
    };
  }, [file]);

  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

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

  useEffect(() => {
    let disposed = false;

    async function renderSheet() {
      if (!pdfRef.current || !canvasRef.current) return;
      setLoading(true);
      try {
        renderTaskRef.current?.cancel();
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

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

        // Sheet aspect from paper size + orientation. Without sim, fall back
        // to the first page's own aspect (plain document view).
        let [mmW, mmH] = PAPER_MM[sim?.paperSize ?? "A4"] ?? PAPER_MM.A4;
        if (sim?.layout === "landscape") [mmW, mmH] = [mmH, mmW];

        let sheetW = containerWidth;
        let sheetH = (sheetW * mmH) / mmW;
        if (fitMode === "page" && sheetH > containerHeight) {
          sheetH = containerHeight;
          sheetW = (sheetH * mmW) / mmH;
        }

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(sheetW * pixelRatio);
        canvas.height = Math.floor(sheetH * pixelRatio);
        canvas.style.width = `${Math.floor(sheetW)}px`;
        canvas.style.maxWidth = "100%";
        canvas.style.height = `${Math.floor(sheetH)}px`;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        // White sheet of paper.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, sheetW, sheetH);

        const marginPx = sheetW * (MARGIN_FRACTION[sim?.margins ?? "default"] ?? 0.05);
        const areaX = marginPx, areaY = marginPx;
        const areaW = sheetW - 2 * marginPx, areaH = sheetH - 2 * marginPx;

        const cols = Math.ceil(Math.sqrt(pps));
        const rows = Math.ceil(pps / cols);
        const cellW = areaW / cols, cellH = areaH / rows;

        const firstIdx = (pageNumber - 1) * pps;
        for (let n = 0; n < pps; n++) {
          const pageIdx = pageList[firstIdx + n];
          if (!pageIdx) break;
          const page = await pdfRef.current.getPage(pageIdx);
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
          renderTaskRef.current = renderTask;
          await renderTask.promise;
          if (disposed) return;

          const drawW = vp.width / pixelRatio, drawH = vp.height / pixelRatio;
          const col = n % cols, row = Math.floor(n / cols);
          const x = areaX + col * cellW + (cellW - drawW) / 2;
          const y = areaY + row * cellH + (cellH - drawH) / 2;
          context.drawImage(off, x, y, drawW, drawH);
          // Faint page outline so multiple pages per sheet read clearly.
          if (pps > 1) {
            context.strokeStyle = "rgba(0,0,0,0.12)";
            context.strokeRect(x, y, drawW, drawH);
          }
        }
      } catch (err) {
        if (!disposed && !(err instanceof Error && err.name === "RenderingCancelledException")) {
          setError("Unable to render this PDF page.");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    renderSheet();

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
    };
  }, [pageNumber, pdfVersion, fitMode, pps, sim?.layout, sim?.paperSize, sim?.margins, pageCount, pageList, containerSize.width, containerSize.height]);

  // Keep the sheet cursor valid when pages-per-sheet (and thus sheet count) changes.
  useEffect(() => {
    if (pageNumber > sheetCount) setPageNumber(sheetCount);
  }, [sheetCount, pageNumber]);

  function handlePageJump() {
    const num = parseInt(pageInput, 10);
    if (Number.isFinite(num) && num >= 1 && num <= sheetCount) {
      setPageNumber(num);
      setPageInput("");
    }
  }

  function handlePageInputKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handlePageJump();
  }

  if (error) {
    return (
      <div className="pdf-preview-fallback">
        <div className="fallback-icon"><FileText size={28} aria-hidden="true" /></div>
        <p>{error}</p>
        <span className="file-info">{file.name}</span>
        <span className="mobile-hint">The file will still be uploaded for printing.</span>
      </div>
    );
  }

  return (
    <div className="pdfjs-preview">
      <div className="pdfjs-toolbar">
        <div className="pdfjs-pagination">
          <button type="button" onClick={() => setPageNumber((page) => Math.max(1, page - 1))} disabled={pageNumber <= 1} aria-label="Previous PDF page" className="pdfjs-nav-btn">
            <ArrowLeft size={18} />
          </button>
          <div className="pdfjs-page-jump">
            <span className="pdfjs-page-label">{pps > 1 ? "Sheet" : "Page"}</span>
            <input
              type="number"
              min="1"
              max={sheetCount}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={handlePageInputKey}
              onBlur={handlePageJump}
              placeholder={String(pageNumber)}
              aria-label={pps > 1 ? "Jump to sheet" : "Jump to page"}
              className="pdfjs-page-input"
            />
            <span className="pdfjs-page-of">of</span>
            <span className="pdfjs-page-total">{sheetCount}</span>
          </div>
          <button type="button" onClick={() => setPageNumber((page) => Math.min(sheetCount, page + 1))} disabled={pageNumber >= sheetCount} aria-label="Next PDF page" className="pdfjs-nav-btn">
            <ArrowRight size={18} />
          </button>
        </div>

        <div className="pdfjs-zoom-controls">
          <button
            type="button"
            className={`pdfjs-fit-btn ${fitMode === "width" ? "active" : ""}`}
            onClick={() => setFitMode("width")}
            aria-label="Fit to width"
            title="Fit to width"
          >
            <Maximize2 size={16} />
          </button>
          <button
            type="button"
            className={`pdfjs-fit-btn ${fitMode === "page" ? "active" : ""}`}
            onClick={() => setFitMode("page")}
            aria-label="Fit to page"
            title="Fit to page"
          >
            <Minimize2 size={16} />
          </button>
        </div>
      </div>
      <div className="pdfjs-canvas-wrap" ref={containerRef}>
        {loading ? (
          <div className="pdfjs-loading">
            <Loader2 size={20} className="spin" />
            Rendering preview...
          </div>
        ) : null}
        <canvas ref={canvasRef} className="pdfjs-canvas" />
      </div>
    </div>
  );
}
