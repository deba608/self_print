"use client";

import { useEffect, useState } from "react";
import { shouldAutoRotate } from "@/lib/print-layout";
import { PAPER_MM, MARGIN_FRACTION } from "./PdfCanvasPreview";

// Photo preview that honours the chosen paper + orientation. The old plain
// <img> always showed the file as-is, so picking Landscape changed nothing
// on screen while the agent still rotated the photo onto a landscape sheet.
// This renders the same sheet the PDF preview uses and rotates on exactly
// the agent's terms (see shouldAutoRotate), so WYSIWYG holds for photos too.
export default function ImageSheetPreview({
  src,
  alt,
  paperSize,
  layout,
  margins,
  scale,
}: {
  src: string;
  alt: string;
  paperSize: string;
  layout: string;
  margins: string;
  scale: string;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDims(null);
    const img = new Image();
    img.onload = () => {
      if (!cancelled && img.naturalWidth > 0 && img.naturalHeight > 0) {
        setDims({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
      img.onload = null;
    };
  }, [src]);

  let [mmW, mmH] = PAPER_MM[paperSize] ?? PAPER_MM.A4;
  if (layout === "landscape") [mmW, mmH] = [mmH, mmW];
  const mf = MARGIN_FRACTION[margins] ?? 0.05;
  // Inner printable area in the same units (margin = fraction of sheet width,
  // matching the PDF preview's px math).
  const inW = mmW - 2 * mf * mmW;
  const inH = mmH - 2 * mf * mmW;

  const rotate =
    dims !== null &&
    shouldAutoRotate({ pagesPerSheet: 1, scaleMode: scale, pageW: dims.w, pageH: dims.h, cellW: inW, cellH: inH });

  // Post-rotation the drawn box is b×a; fit it inside the inner area with
  // plain percentages, so no pixel measuring is needed. Unrotated: fill.
  let imgW = "100%";
  let imgH = "100%";
  if (rotate && dims) {
    const r = dims.w / dims.h;
    imgW = `${Math.min(100, (inH * r * 100) / inW)}%`;
    imgH = `${Math.min(100, (inW / r * 100) / inH)}%`;
  }

  return (
    <div className="pdfjs-scroll-sheet-card" style={{ width: "100%" }}>
      <div className="pdfjs-scroll-sheet-badge">
        {layout === "landscape" ? "Landscape" : "Portrait"} · {paperSize}
      </div>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: `${mmW} / ${mmH}`,
          background: "#fff",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: `${(mf * mmW * 100) / mmH}% ${(mf * 100).toFixed(2)}%`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Keep preview-image class so the B&W grayscale sim still applies. */}
          <img
            src={src}
            alt={alt}
            className="preview-image"
            style={{
              width: imgW,
              height: imgH,
              maxHeight: "100%",
              objectFit: "contain",
              transform: rotate ? "rotate(90deg)" : undefined,
            }}
          />
        </div>
      </div>
    </div>
  );
}
