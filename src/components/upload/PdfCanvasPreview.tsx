"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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

// Margin fractions of sheet width
const MARGIN_FRACTION: Record<string, number> = { default: 0.05, minimum: 0.02, none: 0 };

export type PreviewSim = {
  pagesPerSheet: number;
  layout: string;
  paperSize: string;
  margins: string;
  pages?: number[] | null;
};

type PdfDoc = {
  destroy: () => Promise<void> | void;
  numPages: number;
  getPage: (page: number) => Promise<any>;
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
  const outerRef = useRef<HTMLDivElement>(null);      // outer layout wrapper (for ResizeObserver)
  const scrollRef = useRef<HTMLDivElement>(null);      // the scrollable stage
  const canvasListRef = useRef<HTMLDivElement>(null);  // imperative canvas list

  const pdfRef = useRef<PdfDoc | null>(null);
  const renderAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const [pageCount, setPageCount] = useState(fallbackPageCount);
  const [pdfReady, setPdfReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSheet, setActiveSheet] = useState(1);
  const [totalSheets, setTotalSheets] = useState(1);
  const [fitMode, setFitMode] = useState<"width" | "page">("width");

  // -- Measure available width from the outer wrapper --
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setContainerW(Math.floor(rect.width) || el.clientWidth || 0);
      setContainerH(Math.floor(rect.height) || el.clientHeight || 0);
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // -- Load PDF document (only when file changes) --
  useEffect(() => {
    let cancelled = false;
    setPdfReady(false);
    setLoading(true);
    setError("");

    (async () => {
      try {
        // Destroy previous
        const prev = pdfRef.current;
        pdfRef.current = null;
        await prev?.destroy?.();

        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const data = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({
          data: new Uint8Array(data),
          disableFontFace: true,
          isEvalSupported: false,
          useWorkerFetch: false,
        } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;

        if (cancelled) { await doc.destroy(); return; }
        pdfRef.current = doc;
        setPageCount(doc.numPages);
        setPdfReady(true);
      } catch {
        if (!cancelled) setError("Unable to render PDF preview on this device.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  // -- Derived: page list and sheet count --
  const pps = Math.max(1, sim?.pagesPerSheet ?? 1);
  const pagesKey = sim?.pages?.join(",") ?? "";
  const pageList = useMemo(() => {
    const selected = (sim?.pages ?? []).filter((p) => p >= 1 && p <= pageCount);
    return selected.length ? selected : Array.from({ length: pageCount }, (_, i) => i + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesKey, pageCount]);
  const sheetCount = Math.max(1, Math.ceil(pageList.length / pps));

  // -- Render all sheets imperatively into canvasListRef --
  const renderSheets = useCallback(async () => {
    const pdf = pdfRef.current;
    const list = canvasListRef.current;
    if (!pdf || !list) return;

    // Abort any in-progress render
    renderAbortRef.current.cancelled = true;
    const abort = { cancelled: false };
    renderAbortRef.current = abort;

    list.innerHTML = "";
    setActiveSheet(1);
    setTotalSheets(sheetCount);
    setLoading(true);

    try {
      // Resolve container dimensions — wait a tick if not yet measured
      let cW = containerW;
      let cH = containerH;
      if (!cW || cW < 10) {
        const el = outerRef.current;
        cW = el ? el.clientWidth || el.getBoundingClientRect().width : 320;
      }
      if (!cH || cH < 10) {
        const el = outerRef.current;
        cH = el ? el.clientHeight || el.getBoundingClientRect().height : 480;
      }
      cW = Math.max(cW, 200);
      cH = Math.max(cH, 300);

      let [mmW, mmH] = PAPER_MM[sim?.paperSize ?? "A4"] ?? PAPER_MM.A4;
      if (sim?.layout === "landscape") [mmW, mmH] = [mmH, mmW];

      let sheetW = cW - 24; // 12px padding each side inside scroll
      let sheetH = (sheetW * mmH) / mmW;

      if (fitMode === "page") {
        // Fit entire sheet in one screenful
        const maxH = cH - 80; // subtract toolbar
        if (sheetH > maxH) {
          sheetH = maxH;
          sheetW = (sheetH * mmW) / mmH;
        }
      }

      sheetW = Math.max(sheetW, 120);
      sheetH = Math.max(sheetH, 160);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const mf = MARGIN_FRACTION[sim?.margins ?? "default"] ?? 0.05;
      const marginPx = sheetW * mf;
      const areaW = sheetW - 2 * marginPx;
      const areaH = sheetH - 2 * marginPx;

      const cols = Math.ceil(Math.sqrt(pps));
      const rows = Math.ceil(pps / cols);
      const cellW = areaW / cols;
      const cellH = areaH / rows;

      for (let s = 1; s <= sheetCount; s++) {
        if (abort.cancelled) return;

        // Card wrapper
        const card = document.createElement("div");
        card.className = "pdfjs-scroll-sheet-card";
        card.setAttribute("data-sheet-idx", String(s));
        card.style.width = `${Math.floor(sheetW)}px`;

        // Badge
        const badge = document.createElement("div");
        badge.className = "pdfjs-scroll-sheet-badge";
        badge.textContent = pps > 1 ? `Sheet ${s} / ${sheetCount}` : `Page ${s} / ${sheetCount}`;
        card.appendChild(badge);

        // Canvas
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(sheetW * dpr);
        canvas.height = Math.floor(sheetH * dpr);
        canvas.style.width = `${Math.floor(sheetW)}px`;
        canvas.style.height = `${Math.floor(sheetH)}px`;
        canvas.style.maxWidth = "100%";
        canvas.className = "pdfjs-canvas";
        card.appendChild(canvas);

        list.appendChild(card);

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sheetW, sheetH);

        // Draw pages in this sheet
        const firstIdx = (s - 1) * pps;
        for (let n = 0; n < pps; n++) {
          const pageNum = pageList[firstIdx + n];
          if (!pageNum || abort.cancelled) break;

          const page = await pdf.getPage(pageNum);
          if (abort.cancelled) return;

          const vp1 = page.getViewport({ scale: 1 });
          const fitScale = Math.min(cellW / vp1.width, cellH / vp1.height);
          const scale = Math.max(0.05, fitScale) * dpr;
          const vp = page.getViewport({ scale });

          // Render to offscreen canvas, then blit
          const offscreen = document.createElement("canvas");
          offscreen.width = Math.max(1, Math.floor(vp.width));
          offscreen.height = Math.max(1, Math.floor(vp.height));
          const offCtx = offscreen.getContext("2d");
          if (!offCtx) continue;

          await page.render({ canvasContext: offCtx, viewport: vp }).promise;
          if (abort.cancelled) return;

          const drawW = vp.width / dpr;
          const drawH = vp.height / dpr;
          const col = n % cols;
          const row = Math.floor(n / cols);
          const x = marginPx + col * cellW + (cellW - drawW) / 2;
          const y = marginPx + row * cellH + (cellH - drawH) / 2;

          ctx.drawImage(offscreen, x, y, drawW, drawH);

          if (pps > 1) {
            ctx.strokeStyle = "rgba(0,0,0,0.1)";
            ctx.lineWidth = 0.5;
            ctx.strokeRect(x, y, drawW, drawH);
          }
        }
      }
    } catch (err: any) {
      if (!abort.cancelled && err?.name !== "RenderingCancelledException") {
        setError("Unable to render preview.");
      }
    } finally {
      if (!abort.cancelled) {
        setLoading(false);
        // Set up intersection observer now that all cards are in DOM
        setupObserver();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfReady, fitMode, pps, sim?.layout, sim?.paperSize, sim?.margins, sheetCount, pageList, containerW, containerH]);

  // -- Trigger render when ready and deps change --
  useEffect(() => {
    if (!pdfReady) return;
    renderSheets();
  }, [pdfReady, renderSheets]);

  // -- IntersectionObserver: attach AFTER cards are in DOM (called from renderSheets) --
  const setupObserver = useCallback(() => {
    const list = canvasListRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;

    const cards = list.querySelectorAll(".pdfjs-scroll-sheet-card");
    if (!cards.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the highest intersection ratio
        let best: { idx: number; ratio: number } = { idx: 1, ratio: -1 };
        for (const entry of entries) {
          if (entry.intersectionRatio > best.ratio) {
            const idx = parseInt(entry.target.getAttribute("data-sheet-idx") || "1", 10);
            best = { idx, ratio: entry.intersectionRatio };
          }
        }
        if (best.ratio > 0) setActiveSheet(best.idx);
      },
      {
        root: scroller,     // ← must be the scrollable container
        threshold: [0, 0.25, 0.5, 0.75, 1.0],
      }
    );

    cards.forEach((c) => observer.observe(c));

    // Store cleanup on the element so renderSheets can call it
    (list as any).__observerCleanup?.();
    (list as any).__observerCleanup = () => observer.disconnect();
  }, []);

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      (canvasListRef.current as any)?.__observerCleanup?.();
      renderAbortRef.current.cancelled = true;
    };
  }, []);

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
      {/* Toolbar: page counter + 2-in-1 fit toggle */}
      <div className="pdfjs-toolbar">
        {/* 1 / N page numbering */}
        <div className="pdfjs-page-counter-badge" aria-label="Page counter">
          <FileText size={13} className="pdfjs-page-counter-icon" aria-hidden="true" />
          <span className="pdfjs-page-counter-text">{pps > 1 ? "Sheet" : "Page"}</span>
          <span className="pdfjs-page-counter-numbers">
            <strong className="pdfjs-page-counter-active">{activeSheet}</strong>
            <span className="pdfjs-page-counter-sep">/</span>
            <span className="pdfjs-page-counter-total">{totalSheets}</span>
          </span>
        </div>

        {/* Animated 2-in-1 fit toggle */}
        <button
          type="button"
          className={`pdfjs-fit-toggle-btn ${fitMode === "page" ? "is-fit-page" : "is-fit-width"}`}
          onClick={() => setFitMode((m) => (m === "width" ? "page" : "width"))}
          title={fitMode === "width" ? "Switch to Fit Page" : "Switch to Fit Width"}
          aria-label={fitMode === "width" ? "Switch to Fit Page" : "Switch to Fit Width"}
        >
          <span className="pdfjs-fit-icon-wrap" aria-hidden="true">
            <Maximize2 className="pdfjs-fit-icon fit-width-icon" size={14} />
            <Minimize2 className="pdfjs-fit-icon fit-page-icon" size={14} />
          </span>
          <span className="pdfjs-fit-label">
            {fitMode === "width" ? "Fit Width" : "Fit Page"}
          </span>
        </button>
      </div>

      {/* Canvas area */}
      <div className="pdfjs-canvas-wrap" ref={outerRef}>
        {loading && (
          <div className="pdfjs-loading">
            <Loader2 size={20} className="spin" aria-hidden="true" />
            <span>Rendering preview…</span>
          </div>
        )}
        {/* Scrollable stage */}
        <div className="pdfjs-scroll-container" ref={scrollRef}>
          <div className="pdfjs-sheet-list" ref={canvasListRef} />
        </div>
      </div>
    </div>
  );
}
