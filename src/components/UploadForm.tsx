"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { UploadCloud, Camera, FileText, Image, ArrowLeft, ArrowRight, Check, Eye, X, Loader2 } from "lucide-react";
import { paperSizeLabels, commonPaperSizes } from "@/lib/pricing";

type Pricing = {
  bwPerPagePaise: number;
  colorPerPagePaise: number;
  photoPrintPaise: number;
  copyMultiplier: number;
  a3Multiplier: number;
  a4Multiplier: number;
  a5Multiplier: number;
  a6Multiplier: number;
  b5Multiplier: number;
  legalMultiplier: number;
  photoMultiplier: number;
};

type Step = "upload" | "settings" | "preview" | "done";

export default function UploadForm() {
  const [step, setStep] = useState<Step>("upload");
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then(setPricing)
      .catch(() => {});
  }, []);

  const estimate = useMemo(() => {
    if (!pricing) return 0;
    const selectedPages = pageRange.trim() ? estimateRange(pageRange) : 1;
    if (paperSize === "Photo") return Math.round((pricing.photoPrintPaise / 100) * copies);
    const base = printType === "bw" ? pricing.bwPerPagePaise : pricing.colorPerPagePaise;
    let paperMultiplier = 1;
    switch (paperSize) {
      case "A3": paperMultiplier = pricing.a3Multiplier; break;
      case "A4": case "Letter": paperMultiplier = pricing.a4Multiplier; break;
      case "A5": paperMultiplier = pricing.a5Multiplier; break;
      case "A6": paperMultiplier = pricing.a6Multiplier; break;
      case "B5": paperMultiplier = pricing.b5Multiplier; break;
      case "Legal": paperMultiplier = pricing.legalMultiplier; break;
    }
    return Math.round((base / 100) * selectedPages * copies * paperMultiplier * pricing.copyMultiplier);
  }, [copies, pageRange, paperSize, printType, pricing]);

  const fileTypeLabel = useMemo(() => {
    if (!file) return null;
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) return "PDF";
    if (/\.(jpg|jpeg|png)$/.test(name)) return "Image";
    if (/\.(doc|docx)$/.test(name)) return "Word doc";
    return "File";
  }, [file]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0] ?? null;
    setFile(selectedFile);
    if (selectedFile) {
      if (selectedFile.type === "application/pdf") {
        const url = URL.createObjectURL(selectedFile);
        setPreviewUrl(url);
      } else if (selectedFile.type.startsWith("image/")) {
        const url = URL.createObjectURL(selectedFile);
        setPreviewUrl(url);
      } else {
        setPreviewUrl(null);
      }
      setStep("settings");
    }
  }

  async function handleSubmit() {
    if (!file) return;
    setBusy(true);
    setError("");
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
    setStep("done");
  }

  function goToPreview() {
    setStep("preview");
  }

  function resetForm() {
    setStep("upload");
    setFile(null);
    setPrintType("bw");
    setCopies(1);
    setPageRange("");
    setPaperSize("A4");
    setLayout("portrait");
    setPagesPerSheet(1);
    setMargins("default");
    setScale("default");
    setResult(null);
    setError("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (result) {
    return (
      <div className="result-screen">
        <div className="success-icon"><Check size={48} /></div>
        <p className="muted">Your token number is</p>
        <div className="token">{result.token}</div>
        <p className="price">₹{(result.pricePaise / 100).toFixed(2)}</p>
        <div className="queue-badge">Position #{result.queuePosition}</div>
        <p className="instruction">
          {result.needsConversion
            ? "Document needs conversion. Show token at counter."
            : "Pay at counter, then collect your print."}
        </p>
        <button className="btn-secondary" onClick={resetForm}>Upload Another</button>
      </div>
    );
  }

  return (
    <div className="upload-form">
      {/* Step indicator */}
      <div className="step-indicator">
        <div className={`step ${step === "upload" || step === "settings" || step === "preview" ? "active" : step === "done" ? "done" : ""}`}>
          <span className="step-num">1</span>
          <span className="step-label">Upload</span>
        </div>
        <div className="step-line" />
        <div className={`step ${step === "settings" || step === "preview" ? "active" : step === "done" ? "done" : ""}`}>
          <span className="step-num">2</span>
          <span className="step-label">Settings</span>
        </div>
        <div className="step-line" />
        <div className={`step ${step === "preview" ? "active" : step === "done" ? "done" : ""}`}>
          <span className="step-num">3</span>
          <span className="step-label">Preview</span>
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className="step-content fade-in">
          <div className={`upload-zone ${file ? "has-file" : ""}`}>
            <input
              ref={fileInputRef}
              type="file"
              id="file-input"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png"
              onChange={handleFileChange}
            />
            <label htmlFor="file-input" className="upload-label">
              <UploadCloud size={48} className="upload-icon" />
              <strong>Tap to select file</strong>
              <span className="muted">PDF, JPG, PNG up to 25MB</span>
            </label>
          </div>
        </div>
      )}

      {/* Step 2: Settings */}
      {step === "settings" && (
        <div className="step-content fade-in">
          {/* File summary */}
          <div className="file-summary" onClick={() => setStep("upload")}>
            <span className="file-icon">
              {fileTypeLabel === "PDF" ? <FileText size={20} /> : fileTypeLabel === "Image" ? <Image size={20} /> : <FileText size={20} />}
            </span>
            <span className="file-name">{file?.name}</span>
            <span className="change-link">Change</span>
          </div>

          {/* Print type toggle */}
          <div className="print-type-toggle">
            <button
              type="button"
              className={`toggle-btn ${printType === "bw" ? "active" : ""}`}
              onClick={() => setPrintType("bw")}
            >
              <span className="toggle-label">Black & White</span>
              {pricing && <span className="toggle-price">₹{(pricing.bwPerPagePaise / 100).toFixed(0)}/page</span>}
            </button>
            <button
              type="button"
              className={`toggle-btn color-btn ${printType === "color" ? "active" : ""}`}
              onClick={() => setPrintType("color")}
            >
              <span className="toggle-label">Color</span>
              {pricing && <span className="toggle-price">₹{(pricing.colorPerPagePaise / 100).toFixed(0)}/page</span>}
            </button>
          </div>

          {/* Copies and page range */}
          <div className="form-row">
            <div className="form-group">
              <label>Copies</label>
              <div className="number-input">
                <button onClick={() => setCopies(Math.max(1, copies - 1))}>-</button>
                <input type="number" min="1" max="99" value={copies} onChange={(e) => setCopies(Number(e.target.value))} />
                <button onClick={() => setCopies(Math.min(99, copies + 1))}>+</button>
              </div>
            </div>
            <div className="form-group">
              <label>Page Range</label>
              <input
                type="text"
                placeholder="All or 1-5"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
              />
            </div>
          </div>

          {/* Paper size */}
          <div className="form-group">
            <label>Paper Size</label>
            <select value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
              <optgroup label="A Series (ISO)">
                {commonPaperSizes.map((size) => (
                  <option key={size} value={size}>{paperSizeLabels[size as keyof typeof paperSizeLabels]}</option>
                ))}
              </optgroup>
              <optgroup label="Other Sizes">
                <option value="A6">{paperSizeLabels.A6}</option>
                <option value="B5">{paperSizeLabels.B5}</option>
                <option value="Legal">{paperSizeLabels.Legal}</option>
              </optgroup>
            </select>
          </div>

          {/* Advanced options */}
          <details className="advanced-section">
            <summary>Advanced Options</summary>
            <div className="adv-options">
              <div className="form-row">
                <div className="form-group">
                  <label>Layout</label>
                  <select value={layout} onChange={(e) => setLayout(e.target.value)}>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Pages/Sheet</label>
                  <select value={pagesPerSheet} onChange={(e) => setPagesPerSheet(Number(e.target.value))}>
                    {[1, 2, 4, 6, 9, 16].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Margins</label>
                  <select value={margins} onChange={(e) => setMargins(e.target.value)}>
                    <option value="default">Default</option>
                    <option value="minimum">Minimum</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Scale</label>
                  <select value={scale} onChange={(e) => setScale(e.target.value)}>
                    <option value="default">Auto</option>
                    <option value="fit">Fit to Page</option>
                    <option value="shrink">Shrink if Oversized</option>
                    <option value="noscale">Actual Size</option>
                  </select>
                </div>
              </div>
            </div>
          </details>

          {/* Price box */}
          <div className="price-box">
            <div className="price-row">
              <span>{pageRange.trim() ? "Estimated Total" : "Estimated Price"}</span>
              <strong className="price">₹{estimate.toFixed(2)}</strong>
            </div>
            {!pageRange.trim() && <span className="price-note">Enter page range for exact total</span>}
            {pageRange.trim() && copies > 1 && <span className="price-note">{copies} copies × {paperSizeLabels[paperSize as keyof typeof paperSizeLabels] || paperSize}</span>}
          </div>

          {error && <p className="error-msg">{error}</p>}

          {/* Actions */}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep("upload")}>
              <ArrowLeft size={18} /> Back
            </button>
            <button type="button" className="btn-primary" onClick={goToPreview}>
              Preview <Eye size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && (
        <div className="step-content fade-in">
          <h3 className="preview-title">Review Your Print Job</h3>

          {/* Preview area */}
          <div className="preview-area">
            {file && file.type === "application/pdf" && previewUrl && (
              <iframe src={previewUrl} className="preview-iframe" title="PDF Preview" />
            )}
            {file && file.type.startsWith("image/") && previewUrl && (
              <img src={previewUrl} alt="Image Preview" className="preview-image" />
            )}
            {file && (file.name.endsWith(".doc") || file.name.endsWith(".docx")) && (
              <div className="doc-preview">
                <FileText size={48} />
                <p>Word document preview not available</p>
                <span className="muted">File will be reviewed at the shop</span>
              </div>
            )}
          </div>

          {/* Settings summary */}
          <div className="settings-summary">
            <h4>Print Settings</h4>
            <div className="summary-grid">
              <div className="summary-item">
                <span className="summary-label">File</span>
                <span className="summary-value">{file?.name}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Type</span>
                <span className="summary-value">{printType === "bw" ? "Black & White" : "Color"}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Copies</span>
                <span className="summary-value">{copies}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Pages</span>
                <span className="summary-value">{pageRange || "All"}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Paper</span>
                <span className="summary-value">{paperSizeLabels[paperSize as keyof typeof paperSizeLabels] || paperSize}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Layout</span>
                <span className="summary-value">{layout}</span>
              </div>
              {pagesPerSheet > 1 && (
                <div className="summary-item">
                  <span className="summary-label">Pages/Sheet</span>
                  <span className="summary-value">{pagesPerSheet}</span>
                </div>
              )}
            </div>
          </div>

          {/* Total price */}
          <div className="total-price">
            <span>Total</span>
            <strong>₹{estimate.toFixed(2)}</strong>
          </div>

          {/* Actions */}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setStep("settings")}>
              <ArrowLeft size={18} /> Edit
            </button>
            <button type="button" className="btn-primary" onClick={handleSubmit} disabled={busy}>
              {busy ? <><Loader2 size={18} className="spin" /> Processing...</> : <><Check size={18} /> Confirm & Print</>}
            </button>
          </div>
        </div>
      )}

      {/* Mobile-friendly help text */}
      {step !== "done" && (
        <p className="help-text">
          Need help? Ask the shop staff for assistance.
        </p>
      )}
    </div>
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