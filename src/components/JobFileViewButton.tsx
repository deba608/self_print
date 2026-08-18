"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PdfViewer from "@/components/pdf/PdfViewer";
import {
  Eye,
  FileText,
  FileCode,
  FileImage,
  X,
  Download,
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
  /** Hides the PDF zoom toolbar cluster for a simpler customer-facing viewer
   *  (my-jobs). Admin keeps full zoom controls. */
  simplePdfControls?: boolean;
}

export default function JobFileViewButton({
  files,
  label,
  disabled = false,
  disabledReason,
  variant = "chip",
  className = "",
  simplePdfControls = false,
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
                simplePdfControls={simplePdfControls}
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
  simplePdfControls,
}: {
  fileId: string;
  fileName: string;
  mimeType: string | null;
  fileIndex: number;
  totalFiles: number;
  onClose: () => void;
  simplePdfControls: boolean;
}) {
  const src = `/api/user/files/${fileId}`;
  const isImage = (mimeType ?? "").startsWith("image/");
  const isPdf = (mimeType ?? "") === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

  return (
    <>
      {/* Header: title + multi-file badge + close. PDF's own toolbar (inside
          PdfViewer) carries page count/zoom/search/print/download, so this
          header only needs a download link for the non-PDF branches. */}
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
          {!isPdf && (
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
          )}

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
          <PdfViewer fileUrl={src} fileName={fileName} hideZoomControls={simplePdfControls} />
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
