"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { UploadCloud, FileText, Image, ArrowLeft, ArrowRight, Check, Eye, Loader2, File, Settings2, ZoomIn, ZoomOut } from "lucide-react";
import { formatRupees, paperSizeLabels, commonPaperSizes } from "@/lib/pricing";

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
type PageRangeMode = "all" | "even" | "odd" | "custom";

export default function UploadForm() {
  const [step, setStep] = useState<Step>("upload");
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [printType, setPrintType] = useState("bw");
  const [copies, setCopies] = useState(1);
  const [pageRangeMode, setPageRangeMode] = useState<PageRangeMode>("all");
  const [customPageRange, setCustomPageRange] = useState("");
  const [paperSize, setPaperSize] = useState("A4");
  const [layout, setLayout] = useState("portrait");
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [margins, setMargins] = useState("default");
  const [scale, setScale] = useState("default");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ token: string; pricePaise: number; needsConversion: boolean; queuePosition: number } | null>(null);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filePageCount, setFilePageCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then(setPricing)
      .catch(() => {});
  }, []);

  const effectivePageRange = useMemo(() => {
    if (pageRangeMode === "all") return "";
    if (pageRangeMode === "even") return "even";
    if (pageRangeMode === "odd") return "odd";
    return customPageRange;
  }, [pageRangeMode, customPageRange]);

  const estimate = useMemo(() => {
    if (!pricing) return 0;
    const totalPages = filePageCount ?? 1;
    let selectedPages = totalPages;

    if (pageRangeMode === "even") {
      selectedPages = Math.floor(totalPages / 2);
    } else if (pageRangeMode === "odd") {
      selectedPages = Math.ceil(totalPages / 2);
    } else if (pageRangeMode === "custom" && customPageRange.trim()) {
      selectedPages = estimateRange(customPageRange);
    }

    if (paperSize === "Photo") return (pricing.photoPrintPaise / 100) * copies;
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
    return (base / 100) * selectedPages * copies * paperMultiplier * pricing.copyMultiplier;
  }, [copies, filePageCount, customPageRange, pageRangeMode, paperSize, printType, pricing]);

  const pageInfo = useMemo(() => {
    const totalPages = filePageCount ?? 1;
    if (pageRangeMode === "all") {
      return totalPages > 1 ? `All ${totalPages} pages` : "All pages";
    }
    if (pageRangeMode === "even") {
      const count = Math.floor(totalPages / 2);
      return `${count} even page${count !== 1 ? "s" : ""}`;
    }
    if (pageRangeMode === "odd") {
      const count = Math.ceil(totalPages / 2);
      return `${count} odd page${count !== 1 ? "s" : ""}`;
    }
    if (pageRangeMode === "custom" && customPageRange.trim()) {
      const pages = estimateRange(customPageRange);
      return `${pages} page${pages !== 1 ? "s" : ""}`;
    }
    return totalPages > 1 ? `All ${totalPages} pages` : "All pages";
  }, [filePageCount, pageRangeMode, customPageRange]);

  // Validate custom page range against file page count
  const isValidPageRange = useMemo(() => {
    if (pageRangeMode !== "custom" || !customPageRange.trim() || !filePageCount) return true;
    const pages = new Set<number>();
    for (const part of customPageRange.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const [startRaw, endRaw] = trimmed.split("-");
      const start = parseInt(startRaw, 10);
      const end = endRaw ? parseInt(endRaw, 10) : start;
      if (isNaN(start) || start < 1) return false;
      if (isNaN(end) || end < start) return false;
      if (start > filePageCount || end > filePageCount) return false;
      for (let p = start; p <= end; p++) pages.add(p);
    }
    return pages.size > 0;
  }, [pageRangeMode, customPageRange, filePageCount]);

  const pageRangeValidationMessage = useMemo(() => {
    if (pageRangeMode !== "custom" || !customPageRange.trim() || !filePageCount) return null;
    if (!isValidPageRange) {
      if (!customPageRange.match(/^[\d,\-\s]+$/)) {
        return "Invalid format. Use numbers, commas, or dashes (e.g., 1-5 or 1,3,5)";
      }
      return `Page numbers must be between 1 and ${filePageCount}`;
    }
    return null;
  }, [pageRangeMode, customPageRange, filePageCount, isValidPageRange]);

  const fileTypeLabel = useMemo(() => {
    if (!file) return null;
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf")) return "PDF";
    if (/\.(jpg|jpeg|png)$/.test(name)) return "Image";
    if (/\.(doc|docx)$/.test(name)) return "Word";
    return "File";
  }, [file]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0] ?? null;
    setFile(selectedFile);
    setFilePageCount(null);
    if (selectedFile) {
      if (selectedFile.type === "application/pdf") {
        const url = URL.createObjectURL(selectedFile);
        setPreviewUrl(url);
        const pages = await estimatePdfPages(selectedFile);
        setFilePageCount(pages);
      } else if (selectedFile.type.startsWith("image/")) {
        const url = URL.createObjectURL(selectedFile);
        setPreviewUrl(url);
        setFilePageCount(1);
      } else {
        setPreviewUrl(null);
        setFilePageCount(1);
      }
      setStep("settings");
    }
  }

  async function handleSubmit() {
    if (!file) return;
    // Validate custom page range before submission
    if (pageRangeMode === "custom" && customPageRange.trim() && !isValidPageRange) {
      setError("Please enter valid page numbers within the PDF range.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("printType", printType);
    form.set("copies", String(copies));
    form.set("pageRange", effectivePageRange);
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
    setPageRangeMode("all");
    setCustomPageRange("");
    setPaperSize("A4");
    setLayout("portrait");
    setPagesPerSheet(1);
    setMargins("default");
    setScale("default");
    setFilePageCount(null);
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
      <div className="result-screen result-success" role="status" aria-live="polite">
        <div className="success-animation">
          <div className="success-icon" aria-hidden="true"><Check size={48} /></div>
          <div className="success-burst"></div>
        </div>
        <h2 className="success-title">Print Job Submitted</h2>
        <p className="muted">Your token number is</p>
        <div className="token bounce-in">{result.token}</div>
        <p className="price">₹{estimate.toFixed(2)}</p>
        <div className="queue-badge">Position #{result.queuePosition}</div>
        <p className="instruction">
          {result.needsConversion
            ? "Document needs conversion. Show token at counter."
            : "Pay at counter, then collect your print."}
        </p>
        <button className="btn-secondary" onClick={resetForm}>Upload Another</button>
        <div className="thank-you-note">
          <p>Thank you for using Self_Print</p>
          <p className="visit-again">We appreciate your business</p>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-form">
      {/* Step indicator */}
      <nav className="step-indicator" aria-label="Upload progress">
        <div className={`step ${step === "upload" || step === "settings" || step === "preview" ? "active" : step === "done" ? "done" : ""}`} aria-current={step === "upload" ? "step" : undefined}>
          <span className="step-num" aria-hidden="true">1</span>
          <span className="step-label">Upload</span>
        </div>
        <div className="step-line" aria-hidden="true" />
        <div className={`step ${step === "settings" || step === "preview" ? "active" : step === "done" ? "done" : ""}`} aria-current={step === "settings" ? "step" : undefined}>
          <span className="step-num" aria-hidden="true">2</span>
          <span className="step-label">Settings</span>
        </div>
        <div className="step-line" aria-hidden="true" />
        <div className={`step ${step === "preview" ? "active" : step === "done" ? "done" : ""}`} aria-current={step === "preview" ? "step" : undefined}>
          <span className="step-num" aria-hidden="true">3</span>
          <span className="step-label">Preview</span>
        </div>
      </nav>

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
              <UploadCloud size={56} className="upload-icon" aria-hidden="true" />
              <strong>Tap to select file</strong>
              <span className="muted">PDF, JPG, PNG up to 25MB</span>
            </label>
          </div>
          <div className="supported-formats">
            <span className="format-badge">PDF</span>
            <span className="format-badge">JPG</span>
            <span className="format-badge">PNG</span>
            <span className="format-badge">DOC</span>
          </div>
        </div>
      )}

      {/* Step 2: Settings */}
      {step === "settings" && (
        <div className="step-content fade-in">
          {/* File summary */}
          <button className="file-summary" onClick={() => setStep("upload")} aria-label="Change file">
            <span className="file-icon">
              {fileTypeLabel === "PDF" ? <FileText size={24} aria-hidden="true" /> : fileTypeLabel === "Image" ? <Image size={24} aria-hidden="true" /> : <File size={24} aria-hidden="true" />}
            </span>
            <span className="file-name">{file?.name}</span>
            <span className="change-link">Change</span>
          </button>

          {/* Print type toggle */}
          <div className="print-type-toggle">
            <button
              type="button"
              className={`toggle-btn ${printType === "bw" ? "active" : ""}`}
              onClick={() => setPrintType("bw")}
              aria-pressed={printType === "bw"}
            >
              <span className="toggle-label">Black & White</span>
              {pricing && <span className="toggle-price">{formatRupees(pricing.bwPerPagePaise)}/page</span>}
            </button>
            <button
              type="button"
              className={`toggle-btn color-btn ${printType === "color" ? "active" : ""}`}
              onClick={() => setPrintType("color")}
              aria-pressed={printType === "color"}
            >
              <span className="toggle-label">Color</span>
              {pricing && <span className="toggle-price">{formatRupees(pricing.colorPerPagePaise)}/page</span>}
            </button>
          </div>

          {/* Copies */}
          <div className="form-group">
            <label htmlFor="copies-input">Number of Copies</label>
            <div className="number-input number-input-lg">
              <button
                type="button"
                className="num-btn"
                onClick={() => setCopies(Math.max(1, copies - 1))}
                aria-label="Decrease copies"
              >
                <span>-</span>
              </button>
              <input
                id="copies-input"
                type="number"
                min="1"
                max="99"
                step="1"
                value={copies}
                onChange={(e) => {
                  const val = Math.floor(Number(e.target.value));
                  setCopies(isNaN(val) ? 1 : Math.min(99, Math.max(1, val)));
                }}
                aria-label="Number of copies"
                className="num-display"
              />
              <button
                type="button"
                className="num-btn"
                onClick={() => setCopies(Math.min(99, copies + 1))}
                aria-label="Increase copies"
              >
                <span>+</span>
              </button>
            </div>
          </div>

          {/* Page Range */}
          <div className="form-group">
            <label>Select Pages</label>
            <div className="page-range-selector">
              <div className="page-mode-grid">
                <button
                  type="button"
                  className={`page-mode-btn ${pageRangeMode === "all" ? "active" : ""}`}
                  onClick={() => setPageRangeMode("all")}
                  aria-pressed={pageRangeMode === "all"}
                >
                  <File size={20} className="page-mode-icon" aria-hidden="true" />
                  <span className="page-mode-label">All Pages</span>
                </button>
                <button
                  type="button"
                  className={`page-mode-btn ${pageRangeMode === "even" ? "active" : ""}`}
                  onClick={() => setPageRangeMode("even")}
                  aria-pressed={pageRangeMode === "even"}
                >
                  <span className="page-mode-num">2</span>
                  <span className="page-mode-label">Even Only</span>
                </button>
                <button
                  type="button"
                  className={`page-mode-btn ${pageRangeMode === "odd" ? "active" : ""}`}
                  onClick={() => setPageRangeMode("odd")}
                  aria-pressed={pageRangeMode === "odd"}
                >
                  <span className="page-mode-num">1</span>
                  <span className="page-mode-label">Odd Only</span>
                </button>
                <button
                  type="button"
                  className={`page-mode-btn ${pageRangeMode === "custom" ? "active" : ""}`}
                  onClick={() => setPageRangeMode("custom")}
                  aria-pressed={pageRangeMode === "custom"}
                >
                  <span className="page-mode-num">C</span>
                  <span className="page-mode-label">Custom</span>
                </button>
              </div>
              {pageRangeMode === "custom" && (
                <div className="custom-range-input">
                  <input
                    type="text"
                    placeholder="e.g., 1-5 or 1,3,5"
                    value={customPageRange}
                    onChange={(e) => setCustomPageRange(e.target.value.replace(/[^0-9,\-]/g, ''))}
                    aria-label="Enter custom page range"
                    inputMode="numeric"
                    aria-invalid={!isValidPageRange && !!customPageRange.trim()}
                  />
                  <span className="range-hint">Separate with commas or dash for range</span>
                  {pageRangeValidationMessage && (
                    <span className="range-error" role="alert">
                      {pageRangeValidationMessage}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Paper size */}
          <div className="form-group">
            <label htmlFor="paper-size">Paper Size</label>
            <select
              id="paper-size"
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value)}
              className="mobile-select"
            >
              <optgroup label="A Series">
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
            <summary>
              <Settings2 size={16} aria-hidden="true" />
              <span>Advanced Options</span>
            </summary>
            <div className="adv-options">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="layout-select">Layout</label>
                  <select id="layout-select" value={layout} onChange={(e) => setLayout(e.target.value)} className="mobile-select">
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="pages-per-sheet">Pages per sheet</label>
                  <select id="pages-per-sheet" value={pagesPerSheet} onChange={(e) => setPagesPerSheet(Number(e.target.value))} className="mobile-select">
                    {[1, 2, 4, 6, 9, 16].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="margins-select">Margins</label>
                  <select id="margins-select" value={margins} onChange={(e) => setMargins(e.target.value)} className="mobile-select">
                    <option value="default">Default</option>
                    <option value="minimum">Minimum</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="scale-select">Scale</label>
                  <select id="scale-select" value={scale} onChange={(e) => setScale(e.target.value)} className="mobile-select">
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
            <div className="price-header">
              <span className="price-label">Estimated Price</span>
              <span className="price-value">₹{estimate.toFixed(2)}</span>
            </div>
            <div className="price-breakdown">
              <span className="breakdown-item">{pageInfo}</span>
              <span className="breakdown-sep">x</span>
              <span className="breakdown-item">{copies} {copies === 1 ? "copy" : "copies"}</span>
              <span className="breakdown-sep">x</span>
              <span className="breakdown-item">{paperSizeLabels[paperSize as keyof typeof paperSizeLabels] || paperSize}</span>
            </div>
            {filePageCount && filePageCount > 1 && (
              <span className="page-count-hint">{filePageCount} pages detected</span>
            )}
          </div>

          {error && (
            <div className="error-msg" role="alert">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStep("upload")}
              aria-label="Go back to upload step"
            >
              <ArrowLeft size={20} aria-hidden="true" /> Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={goToPreview}
              disabled={pageRangeMode === "custom" && !!customPageRange.trim() && !isValidPageRange}
              aria-label="Preview print settings"
            >
              Preview <Eye size={20} aria-hidden="true" />
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
            {file && file.type === "application/pdf" && (
              <PdfCanvasPreview file={file} fallbackPageCount={filePageCount ?? 1} />
            )}
            {file && file.type.startsWith("image/") && previewUrl && (
              <img src={previewUrl} alt="Image Preview" className="preview-image" />
            )}
            {file && (file.name.endsWith(".doc") || file.name.endsWith(".docx")) && (
              <div className="doc-preview">
                <File size={48} aria-hidden="true" />
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
                <span className="summary-value">{pageRangeMode === "all" ? "All" : pageRangeMode === "even" ? "Even" : pageRangeMode === "odd" ? "Odd" : customPageRange || "All"}</span>
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
                  <span className="summary-label">Pages per sheet</span>
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
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStep("settings")}
              aria-label="Go back to edit settings"
            >
              <ArrowLeft size={20} aria-hidden="true" /> Edit
            </button>
            <button
              type="button"
              className="btn-primary btn-submit"
              onClick={handleSubmit}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? (
                <><Loader2 size={20} className="spin" aria-hidden="true" /> Processing...</>
              ) : (
                <><Check size={20} aria-hidden="true" /> Confirm Print</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Help text */}
      {step !== "done" && (
        <p className="help-text">
          Need help? Ask the shop staff for assistance.
        </p>
      )}
    </div>
  );
}

function PdfCanvasPreview({ file, fallbackPageCount }: { file: File; fallbackPageCount: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const pdfRef = useRef<{ destroy: () => Promise<void> | void; numPages: number; getPage: (page: number) => Promise<any> } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(fallbackPageCount);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;

    async function loadPdf() {
      setLoading(true);
      setError("");
      setPageNumber(1);
      try {
        renderTaskRef.current?.cancel();
        await pdfRef.current?.destroy?.();
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const data = await file.arrayBuffer();
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const documentParams = {
          data: new Uint8Array(data),
          disableFontFace: true,
          isEvalSupported: false,
          useWorkerFetch: false,
        } as unknown as Parameters<typeof pdfjs.getDocument>[0];
        const pdf = await pdfjs.getDocument(documentParams).promise;
        if (disposed) {
          await pdf.destroy();
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setPdfVersion((version) => version + 1);
      } catch {
        if (!disposed) setError("Unable to render PDF preview on this device.");
      } finally {
        if (!disposed && !pdfRef.current) setLoading(false);
      }
    }

    loadPdf();

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
      pdfRef.current?.destroy?.();
      renderTaskRef.current = null;
      pdfRef.current = null;
    };
  }, [file]);

  useEffect(() => {
    let disposed = false;

    async function renderPage() {
      if (!pdfRef.current || !canvasRef.current) return;
      setLoading(true);
      try {
        renderTaskRef.current?.cancel();
        const page = await pdfRef.current.getPage(pageNumber);
        if (disposed || !canvasRef.current) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth = Math.max((containerRef.current?.clientWidth ?? 320) - 24, 240);
        const fitScale = Math.min(containerWidth / baseViewport.width, 1.75);
        const viewport = page.getViewport({ scale: Math.max(0.4, fitScale * zoom) });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        const renderTask = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err) {
        if (!disposed && !(err instanceof Error && err.name === "RenderingCancelledException")) {
          setError("Unable to render this PDF page.");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    renderPage();

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
    };
  }, [pageNumber, pdfVersion, zoom]);

  if (error) {
    return (
      <div className="pdf-preview-fallback">
        <div className="fallback-icon"><FileText size={28} aria-hidden="true" /></div>
        <p>{error}</p>
        <span className="file-info">{file.name}</span>
        <span className="mobile-hint">The file will still be uploaded for printing.</span>
      </div>
    );
  }

  return (
    <div className="pdfjs-preview">
      <div className="pdfjs-toolbar">
        <button type="button" onClick={() => setPageNumber((page) => Math.max(1, page - 1))} disabled={pageNumber <= 1} aria-label="Previous PDF page">
          <ArrowLeft size={16} />
        </button>
        <span>Page {pageNumber} of {pageCount}</span>
        <button type="button" onClick={() => setPageNumber((page) => Math.min(pageCount, page + 1))} disabled={pageNumber >= pageCount} aria-label="Next PDF page">
          <ArrowRight size={16} />
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.75, value - 0.15))} aria-label="Zoom out">
          <ZoomOut size={16} />
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.min(2, value + 0.15))} aria-label="Zoom in">
          <ZoomIn size={16} />
        </button>
      </div>
      <div className="pdfjs-canvas-wrap" ref={containerRef}>
        {loading ? (
          <div className="pdfjs-loading">
            <Loader2 size={20} className="spin" />
            Rendering preview...
          </div>
        ) : null}
        <canvas ref={canvasRef} className="pdfjs-canvas" />
      </div>
    </div>
  );
}

function estimateRange(value: string) {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const [startRaw, endRaw] = part.trim().split("-");
    const start = Math.floor(Number(startRaw));
    const end = Math.floor(Number(endRaw ?? startRaw));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) continue;
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return Math.max(pages.size, 1);
}

async function estimatePdfPages(file: File) {
  try {
    const bytes = await file.arrayBuffer();
    const text = new TextDecoder("latin1").decode(bytes);
    const matches = text.match(/\/Type\s*\/Page\b/g);
    return Math.max(matches?.length ?? 1, 1);
  } catch {
    return 1;
  }
}
