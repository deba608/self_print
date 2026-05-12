"use client";

import { useEffect, useMemo, useState } from "react";
import { UploadCloud, Camera, FileText, Image } from "lucide-react";

type Pricing = {
  bwPerPagePaise: number;
  colorPerPagePaise: number;
  photoPrintPaise: number;
  copyMultiplier: number;
  a4Multiplier: number;
  legalMultiplier: number;
  photoMultiplier: number;
};

const paperDescriptions: Record<string, string> = {
  A4: "Standard A4 (210 x 297 mm)",
  Letter: "US Letter (8.5 x 11 in)",
  Legal: "US Legal (8.5 x 14 in)",
  Photo: "Photo print (4x6 in)",
};

export default function UploadForm() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [printType, setPrintType] = useState("bw");
  const [copies, setCopies] = useState(1);
  const [pageRange, setPageRange] = useState("");
  const [paperSize, setPaperSize] = useState("A4");
  const [layout, setLayout] = useState("portrait");
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [margins, setMargins] = useState("default");
  const [scale, setScale] = useState("default");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ token: string; pricePaise: number; needsConversion: boolean; queuePosition: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then(setPricing)
      .catch(() => {});
  }, []);

  const estimate = useMemo(() => {
    if (!pricing) return 0;
    const pages = pageRange.trim() ? estimateRange(pageRange) : 1;
    if (paperSize === "Photo") return (pricing.photoPrintPaise / 100) * copies * pricing.photoMultiplier;
    const base = printType === "bw" ? pricing.bwPerPagePaise : pricing.colorPerPagePaise;
    const paperMultiplier = paperSize === "Legal" ? pricing.legalMultiplier : pricing.a4Multiplier;
    return Math.round((base / 100) * pages * copies * paperMultiplier * pricing.copyMultiplier);
  }, [copies, pageRange, paperSize, printType, pricing]);

  const fileTypeLabel = useMemo(() => {
    if (!file) return null;
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) return "PDF";
    if (/\.(jpg|jpeg|png)$/.test(name)) return "Image";
    if (/\.(doc|docx)$/.test(name)) return "Word doc";
    return "File";
  }, [file]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!file) {
      setError("Please choose a file.");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("printType", printType);
    form.set("copies", String(copies));
    form.set("pageRange", pageRange);
    form.set("paperSize", paperSize);
    form.set("layout", layout);
    form.set("pagesPerSheet", String(pagesPerSheet));
    form.set("margins", margins);
    form.set("scale", scale);
    const response = await fetch("/api/jobs", { method: "POST", body: form });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "Upload failed");
      return;
    }
    setResult(body);
  }

  if (result) {
    return (
      <div className="stack">
        <p className="muted">Your token number is</p>
        <div className="token">{result.token}</div>
        <p className="price">₹{(result.pricePaise / 100).toFixed(2)}</p>
        <div className="queue-badge">Position #{result.queuePosition} in queue</div>
        <p className="muted">
          {result.needsConversion
            ? "This document needs conversion. Please show this token at the counter."
            : "Please show this token and pay at the counter. Staff will release the print."}
        </p>
        <button className="secondary" onClick={() => window.location.reload()}>Upload another file</button>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      <div className={`upload-zone ${file ? "has-file" : ""}`}>
        <input type="file" id="file-input"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <label htmlFor="file-input" className="upload-label">
          {file ? (
            <div className="file-info">
              <span className="file-icon">
                {fileTypeLabel === "PDF" ? <FileText size={28} /> :
                 fileTypeLabel === "Image" ? <Image size={28} /> :
                 <FileText size={28} />}
              </span>
              <span className="file-name">{file.name}</span>
              <span className="file-size">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
          ) : (
            <>
              <UploadCloud size={36} className="upload-icon" />
              <strong>Tap to choose file</strong>
              <span className="muted">PDF, JPG, PNG, DOC, DOCX</span>
            </>
          )}
        </label>
      </div>

      <div className="print-type-toggle">
        <button type="button"
          className={`toggle-btn ${printType === "bw" ? "active" : ""}`}
          onClick={() => setPrintType("bw")}>
          Black &amp; white
          {pricing && <span className="toggle-price">₹{(pricing.bwPerPagePaise / 100).toFixed(2)}/page</span>}
        </button>
        <button type="button"
          className={`toggle-btn color-btn ${printType === "color" ? "active" : ""}`}
          onClick={() => setPrintType("color")}>
          Color
          {pricing && <span className="toggle-price">₹{(pricing.colorPerPagePaise / 100).toFixed(2)}/page</span>}
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label>
          Copies
          <input type="number" min="1" max="99" value={copies} onChange={(event) => setCopies(Number(event.target.value))} />
        </label>
        <label>
          Page range
          <input placeholder="e.g. 1-3, 5" value={pageRange} onChange={(event) => setPageRange(event.target.value)} />
        </label>
      </div>

      <label>
        Paper size
        <select value={paperSize} onChange={(event) => setPaperSize(event.target.value)}>
          <option value="A4">A4 — Standard (210 x 297 mm)</option>
          <option value="Letter">Letter — US (8.5 x 11 in)</option>
          <option value="Legal">Legal — US (8.5 x 14 in)</option>
          <option value="Photo">Photo — 4x6 in</option>
        </select>
      </label>

      {paperSize === "Photo" && (
        <div className="photo-note">
          <Camera size={16} /> Photo prints are flat price — no page range or copies multiplier applied.
        </div>
      )}

      <details className="advanced-details">
        <summary>Advanced options</summary>
        <div className="adv-grid">
          <label>
            Layout
            <select value={layout} onChange={(e) => setLayout(e.target.value)}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label>
            Pages per sheet
            <select value={pagesPerSheet} onChange={(e) => setPagesPerSheet(Number(e.target.value))}>
              <option value="1">1 page per sheet</option>
              <option value="2">2 pages per sheet</option>
              <option value="4">4 pages per sheet</option>
              <option value="6">6 pages per sheet</option>
              <option value="9">9 pages per sheet</option>
              <option value="16">16 pages per sheet</option>
            </select>
          </label>
          <label>
            Margins
            <select value={margins} onChange={(e) => setMargins(e.target.value)}>
              <option value="default">Default</option>
              <option value="minimum">Minimum</option>
              <option value="none">No margins</option>
            </select>
          </label>
          <label>
            Scale
            <select value={scale} onChange={(e) => setScale(e.target.value)}>
              <option value="default">Auto (printers default)</option>
              <option value="fit">Fit to page</option>
              <option value="shrink">Shrink oversized pages</option>
              <option value="noscale">No scaling (actual size)</option>
            </select>
          </label>
        </div>
      </details>

      <div className="price-box">
        <span className="muted">Estimated price</span>
        <strong className="price">₹{estimate.toFixed(2)}</strong>
        {copies > 1 && <span className="price-breakdown">{copies} copies · {paperDescriptions[paperSize]}</span>}
      </div>

      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      <button disabled={busy || !file}>
        <UploadCloud size={18} />
        {busy ? "Submitting..." : "Submit print job"}
      </button>
    </form>
  );
}

function estimateRange(value: string) {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const [startRaw, endRaw] = part.trim().split("-");
    const start = Number(startRaw);
    const end = Number(endRaw ?? startRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) continue;
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return Math.max(pages.size, 1);
}