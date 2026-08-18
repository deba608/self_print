"use client";

// Production PDF viewer: single responsive component covering desktop and
// mobile. Renders through pdf.js (already a project dependency, see
// src/lib/pdf-client.ts) onto real <canvas> pages rather than an <iframe> —
// gives consistent rendering across browsers plus zoom/search/thumbnails
// that a native PDF plugin can't offer.
//
// Pages are windowed: only the pages near the viewport (± OVERSCAN screens)
// ever get a mounted <canvas>, so a 500-page document costs the same as a
// 20-page one. See the height-estimation note below for the one tradeoff
// that buys this.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Download,
  Printer,
  Search,
  X,
  Loader2,
  AlertCircle,
  RotateCcw,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { fetchPdfBytes, loadPdfFromBytes, type PdfJsDoc } from "@/lib/pdf-client";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;
const CARD_GAP = 20;
const OVERSCAN_PX = 1200; // extra pixels of pages kept mounted above/below viewport
const SIDEBAR_BREAKPOINT = 900;

export interface PdfViewerProps {
  /** URL the browser can GET the PDF bytes from (same-origin, auth applied by the route itself). */
  fileUrl: string;
  fileName?: string;
  /** Renders a close button in the toolbar when provided. Omit for embedded (non-modal) use. */
  onClose?: () => void;
  className?: string;
  /** Hides the zoom in/reset/out toolbar cluster for a simpler customer-facing
   *  toolbar. Pinch-to-zoom and the +/-/0 keyboard shortcuts still work — this
   *  only declutters the buttons, it doesn't disable zooming. */
  hideZoomControls?: boolean;
}

type Status = "loading" | "ready" | "error";

function normalizeRotation(rotate: number | undefined): number {
  return (((rotate ?? 0) % 360) + 360) % 360;
}

export default function PdfViewer({ fileUrl, fileName = "document.pdf", onClose, className = "", hideZoomControls = false }: PdfViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfJsDoc | null>(null);
  const textCacheRef = useRef<Map<number, string>>(new Map());
  const rafPendingRef = useRef(false);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const [numPages, setNumPages] = useState(0);
  // Page-1 metrics establish one document-wide scale (see docScale below).
  // Using every page's own true width instead would need an upfront scan of
  // the whole document — exactly the "load everything at once" cost this
  // viewer is built to avoid on large PDFs.
  const [pageOneMeta, setPageOneMeta] = useState<{ width: number; aspect: number } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1); // 1 = fit width
  const [containerW, setContainerW] = useState(0);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false); // fullscreen (native or CSS-maximized fallback)
  const [maximizedFallback, setMaximizedFallback] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<number[]>([]); // matching page numbers
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const [flashPage, setFlashPage] = useState<number | null>(null);

  const [printing, setPrinting] = useState(false);
  const [visibleRange, setVisibleRange] = useState({ start: 1, end: 1 });

  // -- Load the document whenever fileUrl (or retry) changes --
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMsg("");
    setProgress(null);
    setPageOneMeta(null);
    setNumPages(0);
    setCurrentPage(1);
    textCacheRef.current.clear();
    setSearchResults([]);
    setSearchQuery("");

    (async () => {
      try {
        const bytes = await fetchPdfBytes(fileUrl, (loaded, total) => {
          if (!cancelled) setProgress({ loaded, total });
        });
        if (cancelled) return;
        const doc = await loadPdfFromBytes(bytes);
        if (cancelled) {
          void doc.destroy?.();
          return;
        }
        if (!doc.numPages || doc.numPages < 1) {
          void doc.destroy?.();
          throw new Error("This PDF has no readable pages.");
        }
        docRef.current = doc;
        const page1 = await doc.getPage(1);
        const rotation = normalizeRotation(page1.rotate);
        const vp1 = page1.getViewport({ scale: 1, rotation });
        if (cancelled) return;
        setPageOneMeta({ width: vp1.width, aspect: vp1.height / vp1.width });
        setNumPages(doc.numPages);
        setStatus("ready");
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err?.message || "Unable to load this PDF.");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      const doc = docRef.current;
      docRef.current = null;
      void doc?.destroy?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, retryKey]);

  // -- Measure the scroll stage width for fit-width sizing --
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setContainerW(Math.floor(el.clientWidth) || 0);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // -- Sidebar defaults open on desktop, closed on mobile/tablet. Below the
  // breakpoint it renders as a full-height overlay (see .pdfv-sidebar CSS),
  // so isNarrow also drives auto-closing it after a tap there instead of
  // leaving it covering the page. --
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(min-width: ${SIDEBAR_BREAKPOINT}px)`);
    setSidebarOpen(mq.matches);
    setIsNarrow(!mq.matches);
    const onChange = (e: MediaQueryListEvent) => {
      setSidebarOpen(e.matches);
      setIsNarrow(!e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const dpr = useMemo(() => Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2), []);

  // Document-wide CSS-px-per-PDF-point scale. Every page uses this same
  // number so pages keep their true relative proportions (an A3 page reads
  // bigger than an A4 page, exactly like a desktop reader) instead of each
  // page being independently stretched to fill the width.
  const docScale = useMemo(() => {
    if (!pageOneMeta || !containerW) return 0;
    const baseTargetW = Math.max(Math.min(containerW - 32, 900), 220);
    return (baseTargetW * zoom) / pageOneMeta.width;
  }, [pageOneMeta, containerW, zoom]);

  const cardW = useMemo(() => (pageOneMeta ? pageOneMeta.width * docScale : 0), [pageOneMeta, docScale]);
  const cardH = useMemo(() => (pageOneMeta ? cardW * pageOneMeta.aspect : 0), [pageOneMeta, cardW]);
  // ponytail: assumes every page shares page 1's aspect ratio for scroll-height
  // math. Holds for the overwhelming majority of real-world PDFs (uniform
  // paper size). A page that's actually a different shape still renders at
  // its own correct size — this estimate only feeds the virtual scrollbar, so
  // a mixed-size document can show a small scroll-position drift rather than
  // a rendering bug. Upgrade path: track measured per-page heights in a map
  // and sum those instead of numPages * rowH once that drift is reported.
  const rowH = cardH + CARD_GAP;

  // -- Recompute the visible page window from scroll position --
  const recomputeRange = useCallback(() => {
    const el = stageRef.current;
    if (!el || !rowH || !numPages) return;
    const scrollTop = el.scrollTop;
    const viewportH = el.clientHeight;
    const start = Math.max(1, Math.floor((scrollTop - OVERSCAN_PX) / rowH) + 1);
    const end = Math.min(numPages, Math.ceil((scrollTop + viewportH + OVERSCAN_PX) / rowH));
    setVisibleRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    const active = Math.min(numPages, Math.max(1, Math.round(scrollTop / rowH) + 1));
    setCurrentPage((prev) => (prev === active ? prev : active));
  }, [rowH, numPages]);

  useEffect(() => {
    recomputeRange();
  }, [recomputeRange]);

  const onStageScroll = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      recomputeRange();
    });
  }, [recomputeRange]);

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, numPages || 1));
      const el = stageRef.current;
      if (el) el.scrollTop = (clamped - 1) * rowH;
      setCurrentPage(clamped);
    },
    [numPages, rowH]
  );

  // -- Zoom controls (anchor on the current page so it doesn't jump away) --
  const applyZoom = useCallback(
    (next: number) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      setZoom(clamped);
    },
    []
  );
  const zoomIn = useCallback(() => applyZoom(zoom + ZOOM_STEP), [applyZoom, zoom]);
  const zoomOut = useCallback(() => applyZoom(zoom - ZOOM_STEP), [applyZoom, zoom]);
  const resetZoom = useCallback(() => applyZoom(1), [applyZoom]);

  const prevRowHRef = useRef(rowH);
  useEffect(() => {
    // Re-anchor scroll position on the current page whenever zoom changes the
    // row height, so "zoom in" doesn't leave the reader looking at a
    // different page than the one they were just on.
    if (prevRowHRef.current !== rowH) {
      prevRowHRef.current = rowH;
      const el = stageRef.current;
      if (el && rowH) el.scrollTop = (currentPage - 1) * rowH;
      recomputeRange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowH]);

  // -- Pinch-to-zoom (touch) --
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const dist = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinchRef.current = { dist: dist(e.touches), zoom };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const factor = dist(e.touches) / pinchRef.current.dist;
        applyZoom(pinchRef.current.zoom * factor);
      }
    };
    const onTouchEnd = () => {
      pinchRef.current = null;
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, applyZoom]);

  // -- Fullscreen (native API, with a CSS-maximize fallback for iOS Safari) --
  useEffect(() => {
    const onChange = () => setIsExpanded(!!document.fullscreenElement || maximizedFallback);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [maximizedFallback]);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      setMaximizedFallback(false);
      setIsExpanded(false);
      return;
    }
    try {
      await el.requestFullscreen();
      setIsExpanded(true);
    } catch {
      // Fullscreen API unsupported/rejected (common on iOS Safari) — fall
      // back to a CSS-only maximized state that behaves the same way.
      setMaximizedFallback((v) => {
        const next = !v;
        setIsExpanded(next);
        return next;
      });
    }
  }, []);

  // -- Print: refetch bytes (route is same-origin, so the browser cache
  // almost always serves this instantly) into a hidden iframe and invoke the
  // browser's own print pipeline, rather than re-implementing pagination. --
  const handlePrint = useCallback(async () => {
    setPrinting(true);
    try {
      const bytes = await fetchPdfBytes(fileUrl);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const blobUrl = URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.src = blobUrl;
      const cleanup = () => {
        URL.revokeObjectURL(blobUrl);
        iframe.remove();
      };
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          cleanup();
        }
        window.addEventListener("focus", cleanup, { once: true });
        setTimeout(cleanup, 60_000);
      };
      document.body.appendChild(iframe);
    } catch {
      // Leave the toolbar's Download button as the fallback path.
    } finally {
      setPrinting(false);
    }
  }, [fileUrl]);

  // -- Search: scans page text lazily in page order, updating results as it
  // goes so the first hits show up without waiting for the whole document. --
  useEffect(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || !docRef.current || status !== "ready") {
      setSearchResults([]);
      setSearchActiveIdx(0);
      return;
    }
    let cancelled = false;
    const doc = docRef.current;
    const timer = setTimeout(() => {
      setSearching(true);
      (async () => {
        const hits: number[] = [];
        for (let i = 1; i <= doc.numPages && hits.length < 200; i++) {
          if (cancelled) return;
          let text = textCacheRef.current.get(i);
          if (text === undefined) {
            try {
              const page = await doc.getPage(i);
              const tc = await page.getTextContent();
              text = (tc.items as any[]).map((it) => it.str ?? "").join(" ").toLowerCase();
              textCacheRef.current.set(i, text);
            } catch {
              text = "";
            }
          }
          if (cancelled) return;
          if (text.includes(query)) {
            hits.push(i);
            setSearchResults([...hits]);
          }
        }
        if (!cancelled) setSearching(false);
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, status]);

  const goToSearchResult = useCallback(
    (idx: number) => {
      if (!searchResults.length) return;
      const clamped = ((idx % searchResults.length) + searchResults.length) % searchResults.length;
      setSearchActiveIdx(clamped);
      const page = searchResults[clamped];
      goToPage(page);
      setFlashPage(page);
      setTimeout(() => setFlashPage((p) => (p === page ? null : p)), 900);
    },
    [searchResults, goToPage]
  );

  // -- Keyboard navigation (skipped while typing in a text field) --
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (typing) {
        if (e.key === "Escape") {
          target?.blur();
          setSearchOpen(false);
        }
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          goToPage(currentPage + 1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          goToPage(currentPage - 1);
          break;
        case "Home":
          e.preventDefault();
          goToPage(1);
          break;
        case "End":
          e.preventDefault();
          goToPage(numPages);
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomIn();
          break;
        case "-":
          e.preventDefault();
          zoomOut();
          break;
        case "0":
          e.preventDefault();
          resetZoom();
          break;
        case "f":
        case "F":
          void toggleFullscreen();
          break;
        case "/":
          e.preventDefault();
          setSearchOpen(true);
          break;
        case "Escape":
          if (searchOpen) setSearchOpen(false);
          else onClose?.();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentPage, numPages, goToPage, zoomIn, zoomOut, resetZoom, toggleFullscreen, searchOpen, onClose]);

  const visiblePages = useMemo(() => {
    if (status !== "ready" || !numPages) return [];
    const out: number[] = [];
    for (let p = visibleRange.start; p <= visibleRange.end; p++) out.push(p);
    return out;
  }, [status, numPages, visibleRange]);

  const topSpacer = (visibleRange.start - 1) * rowH;
  const bottomSpacer = Math.max(0, (numPages - visibleRange.end) * rowH);
  const progressPct = progress && progress.total ? Math.round((progress.loaded / progress.total) * 100) : null;

  return (
    <div ref={rootRef} className={`pdfv-root ${isExpanded ? "is-expanded" : ""} ${className}`}>
      {/* -- Toolbar: same markup for every breakpoint, CSS reflows it -- */}
      <div className="pdfv-toolbar">
        <div className="pdfv-toolbar-group pdfv-toolbar-left">
          <button
            type="button"
            className="pdfv-icon-btn pdfv-sidebar-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide thumbnails" : "Show thumbnails"}
            aria-label={sidebarOpen ? "Hide thumbnails" : "Show thumbnails"}
            aria-pressed={sidebarOpen}
          >
            {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <span className="pdfv-filename" title={fileName}>
            {fileName}
          </span>
        </div>

        <div className="pdfv-toolbar-group pdfv-toolbar-center">
          <button
            type="button"
            className="pdfv-icon-btn"
            onClick={() => goToPage(currentPage - 1)}
            disabled={status !== "ready" || currentPage <= 1}
            aria-label="Previous page"
            title="Previous page (←)"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="pdfv-page-input">
            <input
              type="number"
              min={1}
              max={numPages || 1}
              value={status === "ready" ? currentPage : ""}
              disabled={status !== "ready"}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) goToPage(n);
              }}
              aria-label="Current page"
            />
            <span className="pdfv-page-total">/ {numPages || "–"}</span>
          </div>
          <button
            type="button"
            className="pdfv-icon-btn"
            onClick={() => goToPage(currentPage + 1)}
            disabled={status !== "ready" || currentPage >= numPages}
            aria-label="Next page"
            title="Next page (→)"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="pdfv-toolbar-group pdfv-toolbar-right">
          {!hideZoomControls && (
            <div className="pdfv-zoom-group">
              <button
                type="button"
                className="pdfv-icon-btn"
                onClick={zoomOut}
                disabled={status !== "ready" || zoom <= MIN_ZOOM}
                aria-label="Zoom out"
                title="Zoom out (-)"
              >
                <ZoomOut size={17} />
              </button>
              <button
                type="button"
                className="pdfv-zoom-pct"
                onClick={resetZoom}
                disabled={status !== "ready"}
                title="Reset to fit width (0)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="pdfv-icon-btn"
                onClick={zoomIn}
                disabled={status !== "ready" || zoom >= MAX_ZOOM}
                aria-label="Zoom in"
                title="Zoom in (+)"
              >
                <ZoomIn size={17} />
              </button>
            </div>
          )}

          <button
            type="button"
            className={`pdfv-icon-btn ${searchOpen ? "is-active" : ""}`}
            onClick={() => setSearchOpen((v) => !v)}
            disabled={status !== "ready"}
            aria-label="Search text"
            aria-pressed={searchOpen}
            title="Search (/)"
          >
            <Search size={17} />
          </button>

          <button
            type="button"
            className="pdfv-icon-btn pdfv-desktop-only"
            onClick={handlePrint}
            disabled={status !== "ready" || printing}
            aria-label="Print"
            title="Print"
          >
            {printing ? <Loader2 size={17} className="spin" /> : <Printer size={17} />}
          </button>

          <a
            href={fileUrl}
            download={fileName}
            className="pdfv-icon-btn"
            aria-label="Download"
            title="Download"
          >
            <Download size={17} />
          </a>

          <button
            type="button"
            className="pdfv-icon-btn pdfv-desktop-only"
            onClick={() => void toggleFullscreen()}
            aria-label={isExpanded ? "Exit fullscreen" : "Fullscreen"}
            title="Fullscreen (f)"
          >
            {isExpanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>

          {onClose && (
            <button type="button" className="pdfv-icon-btn pdfv-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {/* -- Search panel -- */}
      {searchOpen && (
        <div className="pdfv-search-bar">
          <Search size={15} aria-hidden="true" />
          <input
            type="text"
            autoFocus
            placeholder="Search in document…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToSearchResult(e.shiftKey ? searchActiveIdx - 1 : searchActiveIdx + 1);
            }}
          />
          <span className="pdfv-search-status">
            {searching
              ? "Searching…"
              : searchQuery
                ? searchResults.length
                  ? `${searchActiveIdx + 1} / ${searchResults.length}`
                  : "No matches"
                : ""}
          </span>
          <button
            type="button"
            className="pdfv-icon-btn"
            onClick={() => goToSearchResult(searchActiveIdx - 1)}
            disabled={!searchResults.length}
            aria-label="Previous match"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="pdfv-icon-btn"
            onClick={() => goToSearchResult(searchActiveIdx + 1)}
            disabled={!searchResults.length}
            aria-label="Next match"
          >
            <ChevronRight size={15} />
          </button>
          <button type="button" className="pdfv-icon-btn" onClick={() => setSearchOpen(false)} aria-label="Close search">
            <X size={15} />
          </button>
        </div>
      )}

      {/* -- Body: sidebar + page stage -- */}
      <div className="pdfv-body">
        {sidebarOpen && status === "ready" && docRef.current && (
          <>
            {/* Mobile only (CSS-gated): dims the page and gives an obvious tap
                target to dismiss the sidebar, since it covers the whole stage
                as an overlay rather than pushing content aside there. */}
            <div className="pdfv-sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
            <PdfThumbSidebar
              doc={docRef.current}
              numPages={numPages}
              currentPage={currentPage}
              aspect={pageOneMeta?.aspect ?? 1.414}
              onSelect={(p) => {
                goToPage(p);
                if (isNarrow) setSidebarOpen(false);
              }}
              onClose={() => setSidebarOpen(false)}
            />
          </>
        )}

        <div className="pdfv-stage" ref={stageRef} onScroll={onStageScroll}>
          {status === "loading" && (
            <div className="pdfv-state">
              <Loader2 size={26} className="spin" aria-hidden="true" />
              <p>Loading PDF…</p>
              {progressPct !== null && (
                <div className="pdfv-progress" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="pdfv-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
              )}
            </div>
          )}

          {status === "error" && (
            <div className="pdfv-state pdfv-state-error" role="alert">
              <AlertCircle size={32} aria-hidden="true" />
              <p className="pdfv-state-title">Could not load PDF</p>
              <p className="pdfv-state-desc">{errorMsg || "The file may be missing, expired, or corrupted."}</p>
              <div className="pdfv-state-actions">
                <button type="button" className="btn-secondary" onClick={() => setRetryKey((k) => k + 1)}>
                  <RotateCcw size={14} aria-hidden="true" /> Retry
                </button>
                <a className="btn-primary" href={fileUrl} download={fileName}>
                  <Download size={14} aria-hidden="true" /> Download instead
                </a>
              </div>
            </div>
          )}

          {status === "ready" && numPages > 0 && docRef.current && cardW > 0 && (
            <div className="pdfv-list" style={{ paddingTop: topSpacer, paddingBottom: bottomSpacer }}>
              {visiblePages.map((p) => (
                <PdfPageCard
                  key={p}
                  doc={docRef.current!}
                  pageNum={p}
                  docScale={docScale}
                  dpr={dpr}
                  cardWidthCss={cardW}
                  cardHeightCss={cardH}
                  isFlash={flashPage === p}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -- One PDF page: owns its own render lifecycle so cancellation and
// re-render (on zoom change) fall out of normal React effect cleanup. --
function PdfPageCard({
  doc,
  pageNum,
  docScale,
  dpr,
  cardWidthCss,
  cardHeightCss,
  isFlash,
}: {
  doc: PdfJsDoc;
  pageNum: number;
  docScale: number;
  dpr: number;
  cardWidthCss: number;
  cardHeightCss: number;
  isFlash: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [cssDims, setCssDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: any = null;
    setLoaded(false);

    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const rotation = normalizeRotation(page.rotate);
        const vp = page.getViewport({ scale: docScale * dpr, rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const cssW = vp.width / dpr;
        const cssH = vp.height / dpr;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        if (!cancelled) setCssDims({ w: cssW, h: cssH });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        task = page.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
        if (!cancelled) setLoaded(true);
      } catch {
        // RenderingCancelledException is expected churn from fast scroll/zoom;
        // anything else leaves this single page blank rather than failing
        // the whole viewer.
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNum, docScale, dpr]);

  return (
    <div
      className={`pdfv-page ${loaded ? "is-loaded" : "is-pending"} ${isFlash ? "is-flash" : ""}`}
      data-page-num={pageNum}
      style={{ width: cssDims?.w ?? cardWidthCss, height: cssDims?.h ?? cardHeightCss }}
    >
      <span className="pdfv-page-badge">{pageNum}</span>
      <canvas ref={canvasRef} className="pdfv-canvas" />
    </div>
  );
}

// -- Thumbnail sidebar (desktop, toggleable). Thumbnails render lazily via
// IntersectionObserver — a plain empty <div> per page costs nothing, only
// the tiny canvas paint is deferred until it's about to scroll into view. --
function PdfThumbSidebar({
  doc,
  numPages,
  currentPage,
  aspect,
  onSelect,
  onClose,
}: {
  doc: PdfJsDoc;
  numPages: number;
  currentPage: number;
  aspect: number;
  onSelect: (page: number) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const THUMB_W = 96;
  const thumbH = Math.round(THUMB_W * aspect);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentPage]);

  const pages = useMemo(() => Array.from({ length: numPages }, (_, i) => i + 1), [numPages]);

  return (
    <div className="pdfv-sidebar" ref={listRef}>
      {/* CSS-gated to mobile only — desktop dismisses via the toolbar toggle. */}
      <div className="pdfv-sidebar-head">
        <span>Pages</span>
        <button type="button" className="pdfv-icon-btn" onClick={onClose} aria-label="Close page list">
          <X size={16} />
        </button>
      </div>
      {pages.map((p) => (
        <PdfThumb
          key={p}
          doc={doc}
          pageNum={p}
          width={THUMB_W}
          height={thumbH}
          active={p === currentPage}
          onRef={p === currentPage ? (node) => { activeRef.current = node; } : undefined}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function PdfThumb({
  doc,
  pageNum,
  width,
  height,
  active,
  onRef,
  onSelect,
}: {
  doc: PdfJsDoc;
  pageNum: number;
  width: number;
  height: number;
  active: boolean;
  onRef?: (node: HTMLButtonElement | null) => void;
  onSelect: (page: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLButtonElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || rendered) return;
    if (typeof IntersectionObserver === "undefined") {
      setRendered(true);
      return;
    }
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          if (!cancelled) setRendered(true);
        }
      },
      { root: el.closest(".pdfv-sidebar"), rootMargin: "400px 0px" }
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [rendered]);

  useEffect(() => {
    if (!rendered) return;
    let cancelled = false;
    let task: any = null;
    (async () => {
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const rotation = normalizeRotation(page.rotate);
        const unscaled = page.getViewport({ scale: 1, rotation });
        const scale = width / unscaled.width;
        const vp = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        task = page.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
      } catch {
        // Leave the thumb blank on failure; the main page view is authoritative.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNum, rendered, width]);

  return (
    <button
      type="button"
      ref={(node) => {
        wrapRef.current = node;
        onRef?.(node);
      }}
      className={`pdfv-thumb ${active ? "is-active" : ""}`}
      style={{ width, height }}
      onClick={() => onSelect(pageNum)}
      title={`Page ${pageNum}`}
    >
      {rendered ? <canvas ref={canvasRef} /> : <span className="pdfv-thumb-skeleton" />}
      <span className="pdfv-thumb-num">{pageNum}</span>
    </button>
  );
}
