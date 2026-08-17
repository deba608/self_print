"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { FileText, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { loadPdfDocument, type PdfJsDoc } from "@/lib/pdf-client";

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

  const pdfRef = useRef<PdfJsDoc | null>(null);
  const renderAbortRef = useRef<{ cancelled: boolean; tasks: Set<{ cancel: () => void }> }>({
    cancelled: false,
    tasks: new Set(),
  });

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

        const doc = await loadPdfDocument(file);

        if (cancelled) { await doc.destroy(); return; }
        if (!doc.numPages || doc.numPages < 1) {
          await doc.destroy();
          setError("This PDF has no pages to preview.");
          return;
        }
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
      const doc = pdfRef.current;
      pdfRef.current = null;
      void doc?.destroy?.();
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

    // Abort any in-progress render (both the flag and the underlying pdf.js tasks)
    renderAbortRef.current.cancelled = true;
    renderAbortRef.current.tasks.forEach((t) => t.cancel());
    const abort: { cancelled: boolean; tasks: Set<{ cancel: () => void }> } = { cancelled: false, tasks: new Set() };
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
        // Fit entire sheet in one screenful. cH is measured from the
        // canvas-wrap element, which already excludes the toolbar (a sibling),
        // so only a small breathing-room padding needs subtracting here.
        const maxH = cH - 16;
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

      // Phase 1: lay out every sheet's placeholder card synchronously — sheet
      // dimensions come from the chosen paper size, not the PDF content, so
      // this needs no pdf.js calls and the scroll stage gets correct height
      // instantly instead of growing as pages render in.
      const canvasBySheet = new Map<number, HTMLCanvasElement>();
      for (let s = 1; s <= sheetCount; s++) {
        const card = document.createElement("div");
        card.className = "pdfjs-scroll-sheet-card is-pending";
        card.setAttribute("data-sheet-idx", String(s));
        card.style.width = `${Math.floor(sheetW)}px`;

        const badge = document.createElement("div");
        badge.className = "pdfjs-scroll-sheet-badge";
        badge.textContent = pps > 1 ? `Sheet ${s} / ${sheetCount}` : `Page ${s} / ${sheetCount}`;
        card.appendChild(badge);

        const canvas = document.createElement("canvas");
        canvas.style.width = `${Math.floor(sheetW)}px`;
        canvas.style.height = `${Math.floor(sheetH)}px`;
        canvas.style.maxWidth = "100%";
        canvas.className = "pdfjs-canvas";
        card.appendChild(canvas);

        list.appendChild(card);
        canvasBySheet.set(s, canvas);
      }
      setLoading(false);
      if (abort.cancelled) return;

      // Phase 2: render each sheet's composited canvas on demand as it nears
      // the viewport, with a small concurrency cap so pdf.js can overlap work
      // instead of blocking the whole document on one page at a time.
      const rendered = new Set<number>();
      const queued = new Set<number>();
      const queue: number[] = [];
      let active = 0;
      const MAX_CONCURRENT = 2;

      const renderOneSheet = async (s: number) => {
        if (abort.cancelled || rendered.has(s)) return;
        const canvas = canvasBySheet.get(s);
        if (!canvas) return;
        canvas.width = Math.floor(sheetW * dpr);
        canvas.height = Math.floor(sheetH * dpr);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sheetW, sheetH);

        try {
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

            const task = page.render({ canvasContext: offCtx, viewport: vp });
            abort.tasks.add(task);
            await task.promise;
            abort.tasks.delete(task);
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
          if (abort.cancelled) return;
          rendered.add(s);
          canvas.closest(".pdfjs-scroll-sheet-card")?.classList.remove("is-pending");
          canvas.closest(".pdfjs-scroll-sheet-card")?.classList.add("is-rendered");
        } catch (err: any) {
          if (!abort.cancelled && err?.name !== "RenderingCancelledException") {
            // Leave this single sheet blank rather than failing the whole preview.
          }
        }
      };

      const pump = () => {
        while (active < MAX_CONCURRENT && queue.length && !abort.cancelled) {
          const s = queue.shift()!;
          queued.delete(s);
          active++;
          renderOneSheet(s).finally(() => {
            active--;
            pump();
          });
        }
      };

      const schedule = (s: number, priority = false) => {
        if (rendered.has(s) || queued.has(s) || abort.cancelled) return;
        queued.add(s);
        if (priority) queue.unshift(s);
        else queue.push(s);
        pump();
      };

      schedule(1, true);
      if (sheetCount > 1) schedule(2, true);

      setupObserver(schedule);
    } catch (err: any) {
      if (!abort.cancelled && err?.name !== "RenderingCancelledException") {
        setError("Unable to render preview.");
      }
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfReady, fitMode, pps, sim?.layout, sim?.paperSize, sim?.margins, sheetCount, pageList, containerW, containerH]);

  // -- Trigger render when ready and deps change --
  useEffect(() => {
    if (!pdfReady) return;
    renderSheets();
  }, [pdfReady, renderSheets]);

  // -- IntersectionObserver: attach AFTER placeholders are in DOM (called from
  // renderSheets). Drives both lazy-render scheduling and active-sheet tracking. --
  const setupObserver = useCallback((schedule: (s: number, priority?: boolean) => void) => {
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
          const idx = parseInt(entry.target.getAttribute("data-sheet-idx") || "1", 10);
          if (entry.isIntersecting) schedule(idx, true);
          if (entry.intersectionRatio > best.ratio) best = { idx, ratio: entry.intersectionRatio };
        }
        if (best.ratio > 0) setActiveSheet(best.idx);
      },
      {
        root: scroller,     // ← must be the scrollable container
        rootMargin: "800px 0px", // pre-render sheets just before they scroll into view
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
      renderAbortRef.current.tasks.forEach((t) => t.cancel());
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
