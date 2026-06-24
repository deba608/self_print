"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Printer, AlertCircle, ChevronLeft, ExternalLink } from "lucide-react";

type JobFile = { id: string; originalName: string; mimeType: string; fileKind: string };
type JobInfo = {
  copies: number;
  pageRange: string | null;
  paperSize: string;
  printType: string;
  layout: string;
  pageCount: number;
};

function pagesLabel(range: string | null, pageCount: number) {
  if (!range) return `All${pageCount ? ` (${pageCount})` : ""}`;
  if (range.toLowerCase() === "even") return "Even pages only";
  if (range.toLowerCase() === "odd") return "Odd pages only";
  return range;
}

// Manual / backup print mode. Fetches the job's file as a SAME-ORIGIN blob and
// pushes it through the browser's native print dialog, so the operator picks the
// printer and settings in Windows directly — no agent involved. This is the
// fallback for when automated release/agent printing is unavailable.
export default function ManualPrint({ id }: { id: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Preparing file for printing...");
  const [file, setFile] = useState<JobFile | null>(null);
  const [job, setJob] = useState<JobInfo | null>(null);
  const [token, setToken] = useState("");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  async function prepare() {
    setStatus("loading");
    setMessage("Preparing file for printing...");
    try {
      const detailRes = await fetch(`/api/admin/jobs/${id}`, { credentials: "include" });
      if (!detailRes.ok) throw new Error("Could not load job.");
      const detail = await detailRes.json();
      setToken(detail.job?.token ?? "");
      if (detail.job) {
        setJob({
          copies: detail.job.copies,
          pageRange: detail.job.pageRange ?? null,
          paperSize: detail.job.paperSize,
          printType: detail.job.printType,
          layout: detail.job.layout,
          pageCount: detail.job.pageCount
        });
      }

      if (detail.job?.needsConversion === 1) {
        setStatus("error");
        setMessage("This DOC/DOCX job must be converted to PDF before printing. Convert it first, then try again.");
        return;
      }
      if (!detail.file) {
        setStatus("error");
        setMessage("No file is attached to this job.");
        return;
      }
      setFile(detail.file);

      const fileRes = await fetch(`/api/uploads/${detail.file.id}`, { credentials: "include" });
      if (!fileRes.ok) throw new Error(`File download failed (${fileRes.status}).`);
      const blob = await fileRes.blob();

      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      const isImage = (detail.file.mimeType || "").startsWith("image/");
      const iframe = iframeRef.current;
      if (!iframe) return;

      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setStatus("ready");
          setMessage("Print dialog opened. Pick your printer and settings, then print.");
        } catch {
          setStatus("ready");
          setMessage("File loaded. Press Ctrl+P in the preview if the dialog didn't open.");
        }
      };

      if (isImage) {
        // Wrap the image so it fits the page; blob URL inside srcdoc stays same-origin.
        iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8">
          <style>@page{margin:8mm}html,body{margin:0;height:100%}
          img{display:block;max-width:100%;max-height:100vh;margin:0 auto;object-fit:contain}</style>
          </head><body><img src="${blobUrl}"></body></html>`;
      } else {
        iframe.removeAttribute("srcdoc");
        iframe.src = blobUrl;
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Something went wrong preparing the print.");
    }
  }

  useEffect(() => {
    prepare();
    return () => { if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <main className="admin-shell manual-print-shell">
      <Link href={`/admin/jobs/${id}`} className="back-link">
        <ChevronLeft size={18} />
        <span>Back to Job</span>
      </Link>

      <div className="manual-print-card">
        <h2 className="manual-print-title">
          <Printer size={20} /> Manual Print {token && <span className="manual-print-token">#{token}</span>}
        </h2>

        {job && (
          <div className="manual-settings">
            <p className="manual-settings-hint">
              The browser dialog does NOT apply these automatically — set them by hand in the print dialog:
            </p>
            <div className="manual-settings-grid">
              <div className="manual-setting"><span>Copies</span><strong>{job.copies}</strong></div>
              <div className="manual-setting"><span>Pages</span><strong>{pagesLabel(job.pageRange, job.pageCount)}</strong></div>
              <div className="manual-setting"><span>Paper</span><strong>{job.paperSize}</strong></div>
              <div className="manual-setting"><span>Color</span><strong>{job.printType === "color" ? "Color" : "Black & White"}</strong></div>
              <div className="manual-setting"><span>Layout</span><strong>{job.layout === "landscape" ? "Landscape" : "Portrait"}</strong></div>
            </div>
          </div>
        )}

        {status === "loading" && (
          <div className="manual-print-state">
            <Loader2 size={28} className="spin" />
            <p>{message}</p>
          </div>
        )}

        {status === "ready" && (
          <div className="manual-print-state">
            <p>{message}</p>
            {file && <p className="manual-print-file">{file.originalName}</p>}
            <div className="manual-print-actions">
              <button type="button" className="job-btn release" onClick={() => iframeRef.current?.contentWindow?.print()}>
                <Printer size={16} /> Open Print Dialog Again
              </button>
              {file && (
                <a className="job-btn" href={`/api/uploads/${file.id}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Open File in New Tab
                </a>
              )}
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="manual-print-state error">
            <AlertCircle size={28} />
            <p>{message}</p>
            <button type="button" className="job-btn" onClick={prepare}>Try Again</button>
          </div>
        )}
      </div>

      {/* Hidden frame that holds the file and drives the browser print dialog. */}
      <iframe ref={iframeRef} title="Print frame" className="manual-print-frame" />
    </main>
  );
}
