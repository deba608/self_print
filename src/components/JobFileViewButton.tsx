"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, X } from "lucide-react";

// Sits inside the job card's <Link> (whole card navigates to /track), so the
// click must not bubble. Opens an in-page overlay with the file embedded —
// images via <img>, everything else (PDF) via <iframe> — instead of a new
// tab, so the customer never leaves My Jobs.
export default function JobFileViewButton({
  fileId,
  fileName,
  mimeType,
}: {
  fileId: string;
  fileName: string;
  mimeType: string | null;
}) {
  const [open, setOpen] = useState(false);

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

  const src = `/api/user/files/${fileId}`;
  const isImage = (mimeType ?? "").startsWith("image/");

  return (
    <>
      <button
        type="button"
        className="jobs-file-view-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Eye size={13} aria-hidden="true" /> View
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="file-viewer-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${fileName}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="file-viewer-panel" onClick={(e) => e.stopPropagation()}>
              <div className="file-viewer-head">
                <span className="file-viewer-name" title={fileName}>{fileName}</span>
                <button
                  type="button"
                  className="file-viewer-close"
                  aria-label="Close preview"
                  onClick={() => setOpen(false)}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <div className="file-viewer-body">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={fileName} className="file-viewer-img" />
                ) : (
                  <iframe src={src} title={fileName} className="file-viewer-frame" />
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
