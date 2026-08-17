"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { loadPdfDocument } from "@/lib/pdf-client";

// Tiny first-page thumbnail for a bulk-selected PDF. Renders once per file at a
// fixed small width; falls back to the generic file icon if pdf.js can't render
// on this device (the file still uploads and prints fine).
export default function BulkThumb({ file, grayscale, width = 44 }: { file: File; grayscale: boolean; width?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let pdf: { destroy: () => Promise<void> | void } | null = null;

    // Wipe previous page's pixels immediately so the new file never shows the
    // old thumbnail while pdf.js is still parsing it (a visible glitch for a
    // second or two whenever a new file replaces an old one).
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setFailed(false);

    async function renderThumb() {
      try {
        const loaded = await loadPdfDocument(file);
        if (disposed) { await loaded.destroy(); return; }
        if (!loaded.numPages || loaded.numPages < 1) { await loaded.destroy(); throw new Error("empty pdf"); }
        pdf = loaded;
        const page = await loaded.getPage(1);
        const canvas = canvasRef.current;
        if (disposed || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        await page.render({ canvas, canvasContext: ctx, viewport } as Parameters<typeof page.render>[0]).promise;
      } catch {
        if (!disposed) setFailed(true);
      }
    }

    renderThumb();
    return () => {
      disposed = true;
      pdf?.destroy?.();
    };
  }, [file, width]);

  if (failed) return <FileText size={18} aria-hidden="true" />;
  return <canvas ref={canvasRef} className={`bulk-thumb ${grayscale ? "bw-sim-img" : ""}`} aria-hidden="true" />;
}
