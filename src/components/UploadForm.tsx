"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { UploadCloud, FileText, Image, ArrowLeft, ArrowRight, Check, Eye, Loader2, File, Settings2, Maximize2, Minimize2, Printer, Smartphone, Copy, QrCode, Store, X } from "lucide-react";
import { formatRupees, paperSizeLabels, allPaperSizes } from "@/lib/pricing";
import { supabaseClient } from "@/lib/supabaseClient";
import BillReceipt, { type BillData } from "./BillReceipt";
import { QRCodeSVG } from "qrcode.react";

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
  duplexBwPerPagePaise: number;
  shopUpiId?: string;
  shopUpiQr?: string;
  shopName?: string;
  razorpayKeyId?: string;
};

// Loads the Razorpay Standard Checkout script once and resolves when ready.
let razorpayScriptPromise: Promise<boolean> | null = null;
function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if ((window as any).Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => {
      razorpayScriptPromise = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

type Step = "upload" | "settings" | "preview" | "converting" | "done" | "docx-warning";
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
  const [scale, setScale] = useState("default");
  const [margins, setMargins] = useState("default");
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [duplex, setDuplex] = useState("simplex");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ token: string; pricePaise: number; needsConversion: boolean; queuePosition: number; pageCount?: number } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [payState, setPayState] = useState<"idle" | "processing" | "paid">("idle");
  // Set once payment is confirmed (Razorpay success, or staff marking the job
  // paid — detected by polling). Switches the token screen to the receipt.
  const [paidInfo, setPaidInfo] = useState<{ method: "online" | "counter"; at: string } | null>(null);
  const [payError, setPayError] = useState("");
  const [payMethod, setPayMethod] = useState<"online" | "offline" | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [filePageCount, setFilePageCount] = useState<number | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkPageCounts, setBulkPageCounts] = useState<number[]>([]);
  // Stable per-file ids, kept index-aligned with bulkFiles/bulkPageCounts and
  // used to key the upload promises (see bulkUploadsRef) so storedName↔file
  // alignment survives any removal, independent of positional index.
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  // Sticky: once a 2+ file selection enters bulk, we stay in bulk UI even if
  // the user removes files down to 1 via the ✕ button. Cleared only on reset
  // or an explicit fresh single-file selection — never derived from length.
  const [bulkMode, setBulkMode] = useState(false);
  // Which bulk file the full print preview shows; row taps switch it. Clamped
  // whenever files are removed so it always points at a real file.
  const [bulkPreviewIndex, setBulkPreviewIndex] = useState(0);
  // True while background bulk uploads are still in flight — Confirm shows an
  // uploading state instead of failing (or waiting silently) when tapped early.
  const [bulkUploading, setBulkUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Separate picker for "Add more" so opening it never clobbers the main
  // input's selection state.
  const addMoreInputRef = useRef<HTMLInputElement>(null);
  const uploadPromiseRef = useRef<Promise<{ isDirectUpload: boolean; storedName?: string; error?: string }> | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  // Upload promises keyed by stable file id (all fed by a single shared
  // /api/uploads/sign call, see startBulkUploads). Keyed by id — not array
  // index — so removeBulkFile can drop one entry without any index desync.
  const bulkUploadsRef = useRef<Map<string, Promise<{ storedName?: string; error?: string; fallback?: boolean }>> | null>(null);
  const bulkUploadAbortControllerRef = useRef<AbortController | null>(null);

  const isBulk = bulkMode;

  // Starts one shared sign request for the whole batch, then kicks off each
  // file's upload as its own promise, stored in a Map keyed by stable id so an
  // individual file can be removed later without disturbing the others.
  function startBulkUploads(selected: File[], ids: string[]): Map<string, Promise<{ storedName?: string; error?: string; fallback?: boolean }>> {
    if (bulkUploadAbortControllerRef.current) {
      bulkUploadAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    bulkUploadAbortControllerRef.current = controller;

    const map = new Map<string, Promise<{ storedName?: string; error?: string; fallback?: boolean }>>();

    if (!supabaseClient) {
      // No direct-to-storage client (NEXT_PUBLIC_* env absent — e.g. local
      // SQLite mode). Fall back to sending the file bytes with the job form.
      ids.forEach((id) => map.set(id, Promise.resolve({ fallback: true })));
      return map;
    }

    const signPromise: Promise<Array<{ objectPath: string; token: string; storedName: string }>> = fetch("/api/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: selected.map((f) => ({ fileName: f.name, mimeType: f.type, sizeBytes: f.size })) }),
      signal: controller.signal,
    }).then(async (res) => {
      const signBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(signBody.error ?? "Could not start upload.");
      return signBody.uploads as Array<{ objectPath: string; token: string; storedName: string }>;
    });

    selected.forEach((file, i) => {
      map.set(ids[i], signPromise
        .then(async (uploads) => {
          const u = uploads[i];
          const { error } = await supabaseClient!.storage
            .from("selfprint")
            .uploadToSignedUrl(u.objectPath, u.token, file, { contentType: file.type || "application/pdf" });
          if (error) return { error: `Upload failed for ${file.name}: ${error.message}` };
          return { storedName: u.storedName };
        })
        .catch((err) => ({ error: err instanceof Error ? err.message : "Upload failed" }))
      );
    });

    return map;
  }

  async function startBackgroundUpload(selectedFile: File) {
    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;

    if (!supabaseClient) {
      return { isDirectUpload: false };
    }

    try {
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: selectedFile.name, mimeType: selectedFile.type, sizeBytes: selectedFile.size }),
        signal: controller.signal,
      });
      const signBody = await signRes.json().catch(() => ({}));
      if (!signRes.ok) {
        throw new Error(signBody.error ?? "Could not start upload.");
      }

      const { error: uploadError } = await supabaseClient.storage
        .from("selfprint")
        .uploadToSignedUrl(signBody.objectPath, signBody.token, selectedFile, {
          contentType: selectedFile.type || "application/octet-stream",
        });

      if (uploadError) {
        throw new Error(`Direct upload failed: ${uploadError.message}`);
      }

      return { isDirectUpload: true, storedName: signBody.storedName };
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      return { isDirectUpload: true, error: err instanceof Error ? err.message : "Upload failed" };
    }
  }

  useEffect(() => {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then(setPricing)
      .catch(() => {});
  }, []);

  // While the token screen shows an unpaid job, poll its status so a staff
  // "Mark Paid" (cash / QR-scan payments) flips this phone to the receipt.
  useEffect(() => {
    if (!result || paidInfo || result.needsConversion) return;
    const paidStatuses = ["paid", "approved", "printing", "printed"];
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${result.token}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (paidStatuses.includes(body.status)) {
          setPaidInfo({ method: "counter", at: body.paidAt ?? new Date().toISOString() });
        }
      } catch {
        /* transient network error — next tick retries */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [result, paidInfo]);

  const effectivePageRange = useMemo(() => {
    if (pageRangeMode === "all") return "";
    if (pageRangeMode === "even") return "even";
    if (pageRangeMode === "odd") return "odd";
    return customPageRange;
  }, [pageRangeMode, customPageRange]);

  const selectedPages = useMemo(() => {
    const totalPages = filePageCount ?? 1;
    if (pageRangeMode === "even") return Math.floor(totalPages / 2);
    if (pageRangeMode === "odd") return Math.ceil(totalPages / 2);
    if (pageRangeMode === "custom" && customPageRange.trim()) return estimateRange(customPageRange);
    return totalPages;
  }, [filePageCount, pageRangeMode, customPageRange]);

  // Bulk mode has no page-range selector, so the price is simply driven by
  // the summed page count across every file in the batch.
  const bulkTotalPages = useMemo(
    () => bulkPageCounts.reduce((sum, count) => sum + (count || 1), 0),
    [bulkPageCounts]
  );

  // Duplex is only physical when the document itself has 2+ pages to print
  // back-to-back. Copies don't help — each copy is its own stack of sheets, so
  // a 1-page doc can never be double-sided regardless of copy count.
  const canDuplex = (isBulk ? bulkTotalPages : selectedPages) >= 2;
  const isDuplexInvalid = duplex !== "simplex" && !canDuplex;

  useEffect(() => {
    if (!canDuplex && duplex !== "simplex") setDuplex("simplex");
  }, [canDuplex, duplex]);

  const estimate = useMemo(() => {
    if (!pricing) return 0;
    // Bulk mode has no page-range selector — price off the summed page count
    // across the whole batch instead of the single-file selectedPages.
    const pages = isBulk ? bulkTotalPages : selectedPages;
    if (paperSize === "Photo") {
      // Round to whole paise exactly like the server (calculatePrice) so the
      // estimate never drifts a paisa from the final charged amount.
      return Math.round(pricing.photoPrintPaise * copies) / 100;
    }
    const isDuplex = duplex !== "simplex";
    const baseSimplex = printType === "bw" ? pricing.bwPerPagePaise : pricing.colorPerPagePaise;
    const baseDuplex = (isDuplex && pricing.duplexBwPerPagePaise && printType === "bw") ? pricing.duplexBwPerPagePaise
      : printType === "bw" ? pricing.bwPerPagePaise : pricing.colorPerPagePaise;

    // Mirrors calculatePrice: pay exactly the advertised per-page rate.
    let pageCostSum = 0;
    if (!isDuplex) {
      pageCostSum = baseSimplex * pages;
    } else {
      const doubleSidedPages = Math.floor(pages / 2) * 2;
      const singleSidedPages = pages % 2;
      pageCostSum = (baseDuplex * doubleSidedPages) + (baseSimplex * singleSidedPages);
    }

    let paperMultiplier = 1;
    switch (paperSize) {
      case "A3": paperMultiplier = pricing.a3Multiplier; break;
      case "A4": case "Letter": paperMultiplier = pricing.a4Multiplier; break;
      case "A5": paperMultiplier = pricing.a5Multiplier; break;
      case "A6": paperMultiplier = pricing.a6Multiplier; break;
      case "B5": paperMultiplier = pricing.b5Multiplier; break;
      case "Legal": paperMultiplier = pricing.legalMultiplier; break;
    }
    // Round to whole paise exactly like the server (calculatePrice) so the
    // estimate never drifts a paisa from the final charged amount.
    return Math.round(pageCostSum * copies * paperMultiplier * pricing.copyMultiplier) / 100;
  }, [copies, selectedPages, paperSize, printType, pricing, duplex, isBulk, bulkTotalPages]);

  // Physical sheets of paper per copy: pages are grouped pagesPerSheet-per-side,
  // and duplex halves the sheet count (rounded up for a trailing odd side).
  const physicalSheets = useMemo(() => {
    const pages = Math.max(1, isBulk ? bulkTotalPages : selectedPages);
    const sides = Math.ceil(pages / Math.max(1, pagesPerSheet));
    return duplex !== "simplex" ? Math.ceil(sides / 2) : sides;
  }, [isBulk, bulkTotalPages, selectedPages, pagesPerSheet, duplex]);

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

  // Enters (or re-enters) bulk mode with the given PDF set: replaces any
  // single-file state, restarts all background uploads, recomputes page counts.
  // Used by both a fresh 2+ multi-select and the "Add more" flow.
  async function enterBulkMode(selected: File[]) {
    // A bulk selection replaces any single-file state entirely.
    // Abort any single-file upload still in flight from a prior selection.
    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
      uploadAbortControllerRef.current = null;
    }
    uploadPromiseRef.current = null;
    setFile(null);
    setFilePageCount(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    const ids = selected.map(() => crypto.randomUUID());
    setBulkFiles(selected);
    setBulkIds(ids);
    setBulkMode(true);
    setBulkPreviewIndex(0);
    const pageCounts = await Promise.all(selected.map((f) => estimatePdfPages(f)));
    setBulkPageCounts(pageCounts);
    const uploadsMap = startBulkUploads(selected, ids);
    bulkUploadsRef.current = uploadsMap;
    setBulkUploading(true);
    Promise.allSettled([...uploadsMap.values()]).then(() => setBulkUploading(false));
    setStep("settings");
  }

  // "Add more" picker: appends PDFs to the current job. From single-file mode
  // (PDF selected) this converts the job into a bulk job; in bulk mode it
  // grows the batch. All uploads restart so every file shares one sign call.
  async function handleAddMoreFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const added = Array.from(e.target.files ?? []);
    if (addMoreInputRef.current) addMoreInputRef.current.value = "";
    if (added.length === 0) return;

    const nonPdf = added.find((f) => f.type !== "application/pdf");
    if (nonPdf) {
      setError(`Only PDF files can be added to a batch. "${nonPdf.name}" is not a PDF.`);
      return;
    }

    const current = isBulk ? bulkFiles : file && file.type === "application/pdf" ? [file] : [];
    if (!isBulk && file && file.type !== "application/pdf") {
      setError("Adding more files needs a PDF batch — images print as single jobs.");
      return;
    }

    let combined = [...current, ...added];
    if (combined.length > 10) {
      setError("You can print up to 10 files in one job — only the first 10 were kept.");
      combined = combined.slice(0, 10);
    } else {
      setError("");
    }
    await enterBulkMode(combined);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(e.target.files ?? []);

    if (selectedFiles.length > 1) {
      // Bulk mode: 2+ files selected. PDF-only, shared settings, no page range.
      const nonPdf = selectedFiles.find((f) => f.type !== "application/pdf");
      if (nonPdf) {
        setError(`Bulk upload only supports PDF files. Remove "${nonPdf.name}" and try again.`);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      let selected = selectedFiles;
      if (selected.length > 10) {
        setError("You can upload up to 10 files at once — only the first 10 were kept.");
        selected = selected.slice(0, 10);
      } else {
        setError("");
      }

      await enterBulkMode(selected);
      return;
    }

    // Exactly one file (or none) selected — original single-file path,
    // unchanged. Clear any leftover bulk state from a prior selection, and
    // abort any bulk sign/upload still in flight.
    if (bulkUploadAbortControllerRef.current) {
      bulkUploadAbortControllerRef.current.abort();
      bulkUploadAbortControllerRef.current = null;
    }
    setBulkFiles([]);
    setBulkPageCounts([]);
    setBulkIds([]);
    setBulkMode(false);
    setBulkUploading(false);
    bulkUploadsRef.current = null;

    const selectedFile = selectedFiles[0] ?? null;
    // A fresh valid selection clears any stale error (e.g. a rejected bulk
    // attempt's "PDF only" message must not stick to the next file).
    if (selectedFile) setError("");

    if (selectedFile) {
      const name = selectedFile.name.toLowerCase();
      if (name.endsWith(".doc") || name.endsWith(".docx")) {
        setFile(null);
        setFilePageCount(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setStep("docx-warning");
        return;
      }
    }

    setFile(selectedFile);
    setFilePageCount(null);
    if (selectedFile) {
      // Start background upload immediately
      uploadPromiseRef.current = startBackgroundUpload(selectedFile).catch((err) => {
        if (err.name === "AbortError") return { isDirectUpload: false, error: "Aborted" };
        return { isDirectUpload: false, error: err.message };
      });

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

  function removeBulkFile(i: number) {
    const id = bulkIds[i];
    // Drop the id from all three index-aligned arrays with the same predicate
    // so they stay mutually aligned; drop the upload promise from the Map by
    // its stable id (individual in-flight uploads can't be cancelled, but we
    // stop tracking this one so it's excluded from submit).
    if (id !== undefined) {
      bulkUploadsRef.current?.delete(id);
    }
    setBulkFiles((prev) => prev.filter((_, idx) => idx !== i));
    setBulkPageCounts((prev) => prev.filter((_, idx) => idx !== i));
    setBulkIds((prev) => prev.filter((_, idx) => idx !== i));
    // Keep the full-preview selection pointing at a real file after removal.
    setBulkPreviewIndex((prev) => Math.min(prev > i ? prev - 1 : prev, Math.max(0, bulkFiles.length - 2)));

    // Removing the last file empties the batch — there is nothing to configure
    // or submit, so return to the Upload step and drop bulk mode entirely. When
    // one file remains we deliberately STAY in bulk UI (a submittable list of 1)
    // rather than silently switching to the single-file flow mid-edit.
    if (bulkFiles.length <= 1) {
      if (bulkUploadAbortControllerRef.current) {
        bulkUploadAbortControllerRef.current.abort();
        bulkUploadAbortControllerRef.current = null;
      }
      bulkUploadsRef.current = null;
      setBulkMode(false);
      setBulkUploading(false);
      setError("");
      setStep("upload");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleBulkSubmit() {
    if (bulkFiles.length === 0) return;
    setBusy(true);
    setError("");

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60000);

    try {
      // Resolve each file's upload by its stable id so storedName stays zipped
      // to the correct file regardless of any prior removals.
      const uploadsMap = bulkUploadsRef.current;
      const missing: Promise<{ storedName?: string; error?: string; fallback?: boolean }> = Promise.resolve({ error: "Upload was not started for this file." });
      const uploadResults = await Promise.all(
        bulkIds.map((id) => uploadsMap?.get(id) ?? missing)
      );
      const failed = uploadResults.find((r) => r.error);
      if (failed?.error) {
        throw new Error(failed.error);
      }

      const bulkForm = new FormData();
      bulkForm.set("bulk", "true");
      bulkForm.set("printType", printType);
      bulkForm.set("copies", String(copies));
      bulkForm.set("paperSize", paperSize);
      bulkForm.set("layout", layout);
      bulkForm.set("scale", scale);
      bulkForm.set("margins", margins);
      bulkForm.set("pagesPerSheet", String(pagesPerSheet));
      bulkForm.set("duplex", duplex);

      if (uploadResults.some((r) => r.fallback)) {
        // Direct upload unavailable — send the PDFs themselves; the server
        // saves them and derives page counts from the real bytes.
        // Serverless platforms (Vercel) cap request bodies at ~4.5MB, so a
        // batch above that can never arrive — fail fast with a clear message
        // instead of a cryptic network error.
        const totalBytes = bulkFiles.reduce((s, f) => s + f.size, 0);
        if (totalBytes > 4 * 1024 * 1024) {
          throw new Error(
            `Files total ${(totalBytes / (1024 * 1024)).toFixed(1)} MB — too large to upload together right now (4 MB limit). Remove some files, or upload them one at a time.`
          );
        }
        for (const f of bulkFiles) bulkForm.append("files", f);
      } else {
        const uploadedStoredNames = uploadResults.map((r) => r.storedName);
        if (uploadedStoredNames.some((n) => !n)) {
          throw new Error("Some files failed to upload. Please try again.");
        }
        bulkForm.set("filesJson", JSON.stringify(
          bulkFiles.map((f, i) => ({
            storedName: uploadedStoredNames[i],
            originalName: f.name,
            mimeType: f.type || "application/pdf",
            sizeBytes: f.size,
            pageCount: bulkPageCounts[i] ?? 1,
          }))
        ));
      }

      const response = await fetch("/api/jobs", { method: "POST", body: bulkForm, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Upload failed. Please try again.");
        return;
      }

      setResult(body);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit print job. Please check your connection and try again.");
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (isBulk) {
      await handleBulkSubmit();
      return;
    }
    if (!file) return;
    // Validate custom page range before submission
    if (pageRangeMode === "custom" && customPageRange.trim() && !isValidPageRange) {
      setError("Please enter valid page numbers within the PDF range.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("printType", printType);
    form.set("copies", String(copies));
    form.set("pageRange", effectivePageRange);
    form.set("paperSize", paperSize);
    form.set("layout", layout);
    form.set("scale", scale);
    form.set("margins", margins);
    form.set("pagesPerSheet", String(pagesPerSheet));
    form.set("duplex", duplex);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60000);

    try {
      if (uploadPromiseRef.current) {
        const uploadResult = await uploadPromiseRef.current;
        if (uploadResult.error && uploadResult.error !== "Aborted") {
          throw new Error(uploadResult.error);
        }
        
        if (uploadResult.isDirectUpload && uploadResult.storedName) {
          form.set("isDirectUpload", "true");
          form.set("storedName", uploadResult.storedName);
          form.set("originalName", file.name);
          form.set("mimeType", file.type);
          // Send known values so server skips re-downloading the file just to
          // measure size and count pages (saves 3-8 s on Vercel ↔ Supabase roundtrip).
          form.set("sizeBytes", String(file.size));
          form.set("pageCount", String(filePageCount ?? 1));
        } else {
          form.set("isDirectUpload", "false");
          form.set("file", file);
        }
      } else {
        // Fallback
        form.set("isDirectUpload", "false");
        form.set("file", file);
      }

      const response = await fetch("/api/jobs", { method: "POST", body: form, signal: controller.signal });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Upload failed. Please try again.");
        return;
      }
      
      if (body.needsConversion) {
        setError("Document conversion is required. Please convert to PDF and try again.");
        setStep("upload");
      } else {
        setResult(body);
        setStep("done");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit print job. Please check your connection and try again.");
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
    }
  }

  function goToPreview() {
    if (isDuplexInvalid) {
      setError("Double-sided printing requires at least 2 pages.");
      return;
    }
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
    setScale("default");
    setFilePageCount(null);
    setBulkFiles([]);
    setBulkPageCounts([]);
    setBulkIds([]);
    setBulkMode(false);
    setBulkUploading(false);
    setResult(null);
    setError("");
    setPayState("idle");
    setPaidInfo(null);
    setPayError("");
    setPayMethod(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (bulkUploadAbortControllerRef.current) {
      bulkUploadAbortControllerRef.current.abort();
      bulkUploadAbortControllerRef.current = null;
    }
    bulkUploadsRef.current = null;
    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
      uploadAbortControllerRef.current = null;
    }
    uploadPromiseRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (result) {
    const amountRupees = (result.pricePaise / 100).toFixed(2);
    const upiId = (pricing?.shopUpiId ?? "").trim();
    const upiQr = (pricing?.shopUpiQr ?? "").trim();
    const shopName = pricing?.shopName ?? "Print Shop";

    // Receipt data — everything is already in client state at this point.
    const billFiles = isBulk
      ? bulkFiles.map((f, i) => ({ name: f.name, pages: bulkPageCounts[i] ?? 1 }))
      : [{ name: file?.name ?? "Document", pages: result.pageCount || filePageCount || 1 }];
    const billPerPage = pricing
      ? (duplex !== "simplex" && printType === "bw" && pricing.duplexBwPerPagePaise
          ? pricing.duplexBwPerPagePaise
          : printType === "bw" ? pricing.bwPerPagePaise : pricing.colorPerPagePaise)
      : 0;
    const billData: BillData = {
      shopName,
      token: result.token,
      queuePosition: result.queuePosition,
      files: billFiles,
      settings: { printType, duplex, paperSize, copies, pagesPerSheet },
      totalPaise: result.pricePaise,
      perPagePaise: billPerPage,
      totalPages: result.pageCount || billFiles.reduce((s, f) => s + f.pages, 0),
      paidVia: paidInfo?.method ?? "counter",
      paidAt: paidInfo?.at ?? new Date().toISOString(),
    };

    // Build the UPI intent link.
    // Merchant/aggregator stickers (GetePay, Paytm, etc.) carry signed params
    // (mc, mode, sign, tr) that a rebuilt link would drop — so the payee VPA
    // rejects it. When SHOP_UPI_QR holds the sticker's exact decoded string we
    // pass it through verbatim and only inject the amount + token note.
    // Otherwise fall back to building a plain link from SHOP_UPI_ID.
    let upiLink = "";
    if (upiQr.startsWith("upi://")) {
      const [base, query = ""] = upiQr.split("?");
      const params = new URLSearchParams(query);
      params.set("am", amountRupees);
      params.set("cu", "INR");
      params.set("tn", "Token " + result.token);
      upiLink = `${base}?${params.toString()}`;
    } else if (upiId) {
      upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shopName)}&am=${amountRupees}&tn=${encodeURIComponent("Token " + result.token)}&cu=INR`;
    }

    const upiId_forCopy = upiQr.startsWith("upi://")
      ? new URLSearchParams(upiQr.split("?")[1] ?? "").get("pa") ?? ""
      : upiId;

    const copyUpiId = async () => {
      try {
        await navigator.clipboard.writeText(upiId_forCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* clipboard unavailable — ignore */
      }
    };

    const razorpayKeyId = (pricing?.razorpayKeyId ?? "").trim();
    const showRazorpay = Boolean(razorpayKeyId) && !result.needsConversion && result.pricePaise >= 100;
    // Online payment (UPI QR or Razorpay) is offered as a choice alongside cash.
    const onlineAvailable = !result.needsConversion && (Boolean(upiLink) || showRazorpay);

    async function startRazorpayPayment() {
      if (!result) return;
      setPayError("");
      setPayState("processing");

      const loaded = await loadRazorpayCheckout();
      if (!loaded) {
        setPayState("idle");
        setPayError("Could not load the payment window. Check your connection and retry.");
        return;
      }

      let order: { orderId: string; amount: number; currency: string; keyId: string };
      try {
        const res = await fetch("/api/payments/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: result.token }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.alreadyPaid) {
          setPayState("paid");
          setPaidInfo((p) => p ?? { method: "online", at: new Date().toISOString() });
          return;
        }
        if (!res.ok) throw new Error(data.error ?? "Could not start payment.");
        order = data;
      } catch (err) {
        setPayState("idle");
        setPayError(err instanceof Error ? err.message : "Could not start payment.");
        return;
      }

      const rzp = new (window as any).Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: shopName,
        description: `Token ${result.token}`,
        theme: { color: "#2563eb" },
        // UPI-only: UPI has 0% MDR (zero-MDR mandate), cards/netbanking/wallets
        // carry ~2% — so hide everything except UPI to stay fee-free.
        method: {
          upi: true,
          card: false,
          netbanking: false,
          wallet: false,
          emi: false,
          paylater: false,
        },
        handler: async (response: any) => {
          try {
            const verifyRes = await fetch("/api/payments/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...response, token: result.token }),
            });
            if (!verifyRes.ok) throw new Error("Payment could not be verified.");
            setPayState("paid");
            setPaidInfo({ method: "online", at: new Date().toISOString() });
            setPayError("");
          } catch (err) {
            setPayState("idle");
            setPayError(err instanceof Error ? err.message : "Payment verification failed. Show the counter your payment.");
          }
        },
        modal: {
          ondismiss: () => {
            // Customer closed the window without paying — allow a retry.
            setPayState((s) => (s === "paid" ? s : "idle"));
          },
        },
      });
      rzp.on("payment.failed", (resp: any) => {
        setPayState("idle");
        setPayError(resp?.error?.description ?? "Payment failed. Please try again.");
      });
      rzp.open();
    }

    return (
      <div className="result-screen result-success" role="status" aria-live="polite">
        <div className="success-animation">
          <div className="success-icon" aria-hidden="true"><Check size={48} /></div>
          <div className="success-burst"></div>
        </div>
        <h2 className="success-title">Print Job Submitted</h2>

        {/* Token + queue summary */}
        <div className="result-meta">
          <div className="result-meta-item">
            <span className="result-meta-label">Token</span>
            <span className="result-meta-value token-value bounce-in">{result.token}</span>
          </div>
          <div className="result-meta-divider" aria-hidden="true" />
          <div className="result-meta-item">
            <span className="result-meta-label">Queue</span>
            <span className="result-meta-value">#{result.queuePosition}</span>
          </div>
        </div>

        {paidInfo ? (
          <BillReceipt bill={billData} />
        ) : result.needsConversion ? (
          <div className="counter-card">
            <span className="upi-tag"><Store size={13} aria-hidden="true" /> Pay at Counter</span>
            <p className="counter-msg">
              Your file needs conversion. Show your token at the counter to collect it.
            </p>
            <ol className="upi-steps">
              <li><span className="upi-step-num">1</span> Show token <strong>{result.token}</strong> to staff</li>
              <li><span className="upi-step-num">2</span> Staff prints your file</li>
              <li><span className="upi-step-num">3</span> Collect your print</li>
            </ol>
          </div>
        ) : onlineAvailable ? (
          <>
            {/* Payment method chooser */}
            <div className="pay-choice" role="group" aria-label="Choose how to pay">
              <button
                type="button"
                className={`pay-choice-btn ${payMethod === "online" ? "active" : ""}`}
                onClick={() => setPayMethod("online")}
                aria-pressed={payMethod === "online"}
              >
                <Smartphone size={22} aria-hidden="true" />
                <span className="pay-choice-title">Pay Online</span>
                <span className="pay-choice-sub">UPI / QR</span>
              </button>
              <button
                type="button"
                className={`pay-choice-btn ${payMethod === "offline" ? "active" : ""}`}
                onClick={() => setPayMethod("offline")}
                aria-pressed={payMethod === "offline"}
              >
                <Store size={22} aria-hidden="true" />
                <span className="pay-choice-title">Pay Cash</span>
                <span className="pay-choice-sub">At counter</span>
              </button>
            </div>

            {payMethod === null && (
              <p className="pay-hint">Select a payment method above</p>
            )}

            {payMethod === "online" && (
              showRazorpay ? (
                <div className="upi-card">
                  <div className="upi-card-top">
                    <span className="upi-tag"><QrCode size={13} aria-hidden="true" /> Online Payment</span>
                    <div className="upi-amount">₹{amountRupees}</div>
                    <p className="upi-payee">to {shopName}</p>
                  </div>

                  {payState === "paid" ? (
                    <div className="pay-done" role="status">
                      <Check size={20} aria-hidden="true" />
                      <span>Payment received — show this screen to staff.</span>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="upi-pay-btn"
                        onClick={startRazorpayPayment}
                        disabled={payState === "processing"}
                      >
                        {payState === "processing" ? (
                          <><Loader2 size={20} className="spin" aria-hidden="true" /> Opening…</>
                        ) : (
                          <><Smartphone size={20} aria-hidden="true" /> Pay ₹{amountRupees} now</>
                        )}
                      </button>
                      <p className="upi-apps">GPay · PhonePe · Paytm · BHIM &amp; all UPI apps</p>
                      {payError && <p className="pay-error" role="alert">{payError}</p>}
                    </>
                  )}

                  <ol className="upi-steps">
                    <li><span className="upi-step-num">1</span> Tap Pay and complete payment</li>
                    <li><span className="upi-step-num">2</span> Show this screen to staff</li>
                    <li><span className="upi-step-num">3</span> Collect your print</li>
                  </ol>
                </div>
              ) : (
                <div className="upi-card">
                  <div className="upi-card-top">
                    <span className="upi-tag"><QrCode size={13} aria-hidden="true" /> UPI Payment</span>
                    <div className="upi-amount">₹{amountRupees}</div>
                    <p className="upi-payee">to {shopName}</p>
                  </div>

                  {/* QR payment — intent links get blocked by UPI risk policy
                      for this VPA, so scan-to-pay is the only offered flow. */}
                  <div className="upi-qr-box">
                    <QRCodeSVG value={upiLink} size={184} level="M" marginSize={2} />
                  </div>
                  <p className="upi-apps">Scan with GPay · PhonePe · Paytm · BHIM &amp; all UPI apps</p>

                  {/* Manual fallback — copy the UPI ID */}
                  <button type="button" className="upi-copy" onClick={copyUpiId} aria-live="polite">
                    {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                    <span className="upi-copy-id">{copied ? "Copied!" : upiId_forCopy}</span>
                  </button>

                  <ol className="upi-steps">
                    <li><span className="upi-step-num">1</span> On this phone? Screenshot the QR, then scan it from gallery in your UPI app</li>
                    <li><span className="upi-step-num">2</span> Pay ₹{amountRupees} and show this screen to staff</li>
                    <li><span className="upi-step-num">3</span> Collect your print</li>
                  </ol>
                </div>
              )
            )}

            {payMethod === "offline" && (
              <div className="counter-card">
                <span className="upi-tag"><Store size={13} aria-hidden="true" /> Pay at Counter</span>
                <div className="upi-amount">₹{amountRupees}</div>
                <p className="counter-msg">Pay in cash at the counter, then collect your print.</p>
                <ol className="upi-steps">
                  <li><span className="upi-step-num">1</span> Show token <strong>{result.token}</strong> to staff</li>
                  <li><span className="upi-step-num">2</span> Pay ₹{amountRupees} in cash</li>
                  <li><span className="upi-step-num">3</span> Collect your print</li>
                </ol>
              </div>
            )}
          </>
        ) : (
          <div className="counter-card">
            <span className="upi-tag"><Store size={13} aria-hidden="true" /> Pay at Counter</span>
            <div className="upi-amount">₹{amountRupees}</div>
            <p className="counter-msg">Pay at the counter, then collect your print.</p>
            <ol className="upi-steps">
              <li><span className="upi-step-num">1</span> Show token <strong>{result.token}</strong> to staff</li>
              <li><span className="upi-step-num">2</span> Pay ₹{amountRupees}</li>
              <li><span className="upi-step-num">3</span> Collect your print</li>
            </ol>
          </div>
        )}

        <button className="btn-secondary upload-another" onClick={resetForm}>Upload Another</button>
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
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png"
              onChange={handleFileChange}
            />
            <label htmlFor="file-input" className="upload-label">
              <UploadCloud size={56} className="upload-icon" aria-hidden="true" />
              <strong>Tap to select file</strong>
              <span className="muted">PDF, JPG, PNG up to 25MB · or select 2-10 PDFs at once</span>
            </label>
          </div>
          <div className="supported-formats">
            <span className="format-badge">PDF</span>
            <span className="format-badge">JPG</span>
            <span className="format-badge">PNG</span>
          </div>
          {error && (
            <div className="error-msg" role="alert">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Step 1.5: DOCX Warning */}
      {step === "docx-warning" && (
        <div className="step-content fade-in">
          <div className="warning-card" style={{ padding: "2rem", textAlign: "center", border: "2px solid var(--border-color)", borderRadius: "var(--radius-lg)", background: "var(--bg-card)" }}>
            <FileText size={48} style={{ color: "var(--primary-color)", margin: "0 auto 1rem" }} />
            <h3 style={{ marginBottom: "1rem", fontSize: "1.25rem" }}>For Perfect Printing, Please Convert to PDF</h3>
            <p className="muted" style={{ marginBottom: "2rem", lineHeight: "1.6", fontSize: "0.95rem" }}>
              Word documents (.docx) can lose their exact formatting, fonts, and margins when printed from different computers. To ensure your document prints <strong>exactly</strong> as you see it, please convert it to a PDF first.
            </p>
            <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={() => setStep("upload")}
              >
                Go Back
              </button>
              <a 
                href="https://www.ilovepdf.com/word_to_pdf" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="btn-primary"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              >
                Convert for Free via ILovePDF
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Settings */}
      {step === "settings" && (
        <div className="step-content fade-in">
          {/* File summary */}
          {isBulk ? (
            <button className="file-summary" onClick={() => setStep("upload")} aria-label="Change files">
              <span className="file-icon">
                <FileText size={24} aria-hidden="true" />
              </span>
              <span className="file-name">
                {bulkFiles.length} PDF files
                <span className="file-pages"> ({bulkTotalPages} pages total)</span>
              </span>
              <span className="change-link">Change</span>
            </button>
          ) : (
            <button className="file-summary" onClick={() => setStep("upload")} aria-label="Change file">
              <span className="file-icon">
                {fileTypeLabel === "PDF" ? <FileText size={24} aria-hidden="true" /> : fileTypeLabel === "Image" ? <Image size={24} aria-hidden="true" /> : <File size={24} aria-hidden="true" />}
              </span>
              <span className="file-name">
                {file?.name}
                {file?.type === "application/pdf" && filePageCount && (
                  <span className="file-pages"> ({filePageCount} pages)</span>
                )}
              </span>
              <span className="change-link">Change</span>
            </button>
          )}

          {/* Add more PDFs to this job (converts a single PDF into a batch).
              Hidden for images/docs — bulk is PDF-only. */}
          {(isBulk || file?.type === "application/pdf") && (
            <>
              <input
                ref={addMoreInputRef}
                type="file"
                id="add-more-input"
                multiple
                accept=".pdf,application/pdf"
                onChange={handleAddMoreFiles}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="add-more-btn"
                onClick={() => addMoreInputRef.current?.click()}
                disabled={isBulk && bulkFiles.length >= 10}
                title={isBulk && bulkFiles.length >= 10 ? "Maximum 10 files per job" : undefined}
              >
                <UploadCloud size={16} aria-hidden="true" />
                Add more PDFs
                <span className="add-more-hint">
                  {isBulk ? `${bulkFiles.length}/10 files` : "print several in one job"}
                </span>
              </button>
            </>
          )}

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

          {/* Page Range — not applicable in bulk mode (multiple whole PDFs) */}
          {!isBulk && (
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
          )}

          {/* Paper size */}
          <div className="form-group">
            <label htmlFor="paper-size">Paper Size</label>
            <select
              id="paper-size"
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value)}
              className="mobile-select"
            >
              {allPaperSizes.map((size) => (
                <option key={size} value={size}>{paperSizeLabels[size as keyof typeof paperSizeLabels]}</option>
              ))}
            </select>
          </div>

          {/* Sides */}
          <div className="form-group">
            <label id="sides-label">Sides</label>
            <div className="page-mode-grid" role="group" aria-labelledby="sides-label">
              <button
                type="button"
                className={`page-mode-btn ${duplex === "simplex" ? "active" : ""}`}
                onClick={() => setDuplex("simplex")}
                aria-pressed={duplex === "simplex"}
              >
                <FileText size={20} className="page-mode-icon" aria-hidden="true" />
                <span className="page-mode-label">Single-sided</span>
              </button>
              <button
                type="button"
                className={`page-mode-btn ${duplex !== "simplex" ? "active" : ""}`}
                onClick={() => canDuplex && setDuplex("long-edge")}
                aria-pressed={duplex !== "simplex"}
                disabled={!canDuplex}
                title={!canDuplex ? "Needs a document with at least 2 pages" : undefined}
              >
                <Copy size={20} className="page-mode-icon" aria-hidden="true" />
                <span className="page-mode-label">Double-sided</span>
              </button>
            </div>
            {!canDuplex && (
              <span className="range-hint" style={{ marginTop: "0.25rem", display: "block" }}>
                Double-sided needs a document with at least 2 pages.
              </span>
            )}
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
                  <label htmlFor="scale-select">Scale</label>
                  <select id="scale-select" value={scale} onChange={(e) => setScale(e.target.value)} className="mobile-select">
                    <option value="default">Auto</option>
                    <option value="fit">Fit to Page</option>
                    <option value="shrink">Shrink if Oversized</option>
                    <option value="noscale">Actual Size</option>
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
                  <label htmlFor="pages-per-sheet-select">Pages per Sheet</label>
                  <select id="pages-per-sheet-select" value={pagesPerSheet} onChange={(e) => setPagesPerSheet(Number(e.target.value))} className="mobile-select">
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                  </select>
                </div>
              </div>
            </div>
          </details>

          {/* Price box */}
          <div className="price-box">
            <div className="price-header">
              <span className="price-label">Estimated Price</span>
              <span className="price-value">{pricing ? `₹${estimate.toFixed(2)}` : "…"}</span>
            </div>
            <div className="price-breakdown">
              <span className="breakdown-item">{isBulk ? `${bulkFiles.length} files, ${bulkTotalPages} pages` : pageInfo}</span>
              <span className="breakdown-sep">x</span>
              <span className="breakdown-item">{copies} {copies === 1 ? "copy" : "copies"}</span>
              <span className="breakdown-sep">x</span>
              <span className="breakdown-item">{paperSizeLabels[paperSize as keyof typeof paperSizeLabels] || paperSize}</span>
            </div>
            {!isBulk && filePageCount && filePageCount > 1 && (
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
              disabled={(pageRangeMode === "custom" && !!customPageRange.trim() && !isValidPageRange) || isDuplexInvalid}
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

          {/* Preview area — grayscale simulation when printing B&W */}
          <div className={`preview-area ${printType === "bw" ? "bw-sim" : ""}`}>
            {isBulk && (
              <>
                <div className="bulk-file-list">
                  {bulkFiles.map((f, i) => (
                    <div
                      className={`bulk-file-row ${i === bulkPreviewIndex ? "active" : ""}`}
                      key={i}
                      role="button"
                      tabIndex={0}
                      aria-label={`Preview ${f.name}`}
                      aria-pressed={i === bulkPreviewIndex}
                      onClick={() => setBulkPreviewIndex(i)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBulkPreviewIndex(i); } }}
                    >
                      <BulkThumb file={f} grayscale={printType === "bw"} />
                      <span className="bulk-file-name">{f.name}</span>
                      <span className="bulk-file-pages">{bulkPageCounts[i] ?? 1} pg</span>
                      <button type="button" className="bulk-file-remove" aria-label={`Remove ${f.name}`}
                        onClick={(e) => { e.stopPropagation(); removeBulkFile(i); }}>
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                {/* Full print preview of the tapped file — same viewer as single mode */}
                {bulkFiles[bulkPreviewIndex] && (
                  <PdfCanvasPreview
                    key={bulkIds[bulkPreviewIndex] ?? bulkPreviewIndex}
                    file={bulkFiles[bulkPreviewIndex]}
                    fallbackPageCount={bulkPageCounts[bulkPreviewIndex] ?? 1}
                    sim={{ pagesPerSheet, layout, paperSize, margins }}
                  />
                )}
              </>
            )}
            {file && file.type === "application/pdf" && (
              <PdfCanvasPreview
                file={file}
                fallbackPageCount={filePageCount ?? 1}
                sim={{ pagesPerSheet, layout, paperSize, margins }}
              />
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
                <span className="summary-value">{isBulk ? `${bulkFiles.length} files` : file?.name}</span>
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
                <span className="summary-value">{isBulk ? `${bulkTotalPages} pages total` : pageInfo}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Paper</span>
                <span className="summary-value">{paperSizeLabels[paperSize as keyof typeof paperSizeLabels] || paperSize}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Layout</span>
                <span className="summary-value">{layout === "portrait" ? "Portrait" : "Landscape"}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Sides</span>
                <span className="summary-value">{duplex === "simplex" ? "Single-sided" : "Double-sided"}</span>
              </div>
              {pagesPerSheet > 1 && (
                <div className="summary-item">
                  <span className="summary-label">Pages/Sheet</span>
                  <span className="summary-value">{pagesPerSheet}</span>
                </div>
              )}
            </div>
            {/* Physical output line — the one fact the settings rows can't show */}
            <div className="summary-paper-note">
              <Printer size={14} aria-hidden="true" />
              Prints on {physicalSheets} sheet{physicalSheets === 1 ? "" : "s"} of paper
              {copies > 1 ? ` per copy (${physicalSheets * copies} total)` : ""}
            </div>
          </div>

          {/* Total price */}
          <div className="total-price">
            <span>Total</span>
            <strong>{pricing ? `₹${estimate.toFixed(2)}` : "…"}</strong>
          </div>

          {/* Submit errors must be visible HERE — Confirm lives on this step,
              and the settings-step error block is not rendered here. */}
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
              onClick={() => setStep("settings")}
              aria-label="Go back to edit settings"
            >
              <ArrowLeft size={20} aria-hidden="true" /> Edit
            </button>
            <button
              type="button"
              className="btn-primary btn-submit"
              onClick={handleSubmit}
              disabled={busy || (isBulk && bulkUploading)}
              aria-busy={busy || (isBulk && bulkUploading)}
            >
              {busy ? (
                <><Loader2 size={20} className="spin" aria-hidden="true" /> Processing...</>
              ) : isBulk && bulkUploading ? (
                <><Loader2 size={20} className="spin" aria-hidden="true" /> Uploading files...</>
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

// Paper dimensions in mm, portrait width × height. Landscape swaps them.
const PAPER_MM: Record<string, [number, number]> = {
  A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148],
  B5: [176, 250], Letter: [216, 279], Legal: [216, 356], Photo: [102, 152],
};

// What the print helper does with margins, mirrored for the preview:
// default ≈ driver margins, minimum = 0.25in, none = 0.
const MARGIN_FRACTION: Record<string, number> = { default: 0.05, minimum: 0.02, none: 0 };

type PreviewSim = {
  pagesPerSheet: number;
  layout: string;      // portrait | landscape
  paperSize: string;   // A3..Photo
  margins: string;     // default | minimum | none
};

function PdfCanvasPreview({ file, fallbackPageCount, sim }: { file: File; fallbackPageCount: number; sim?: PreviewSim }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const pdfRef = useRef<{ destroy: () => Promise<void> | void; numPages: number; getPage: (page: number) => Promise<any> } | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [pageCount, setPageCount] = useState(fallbackPageCount);
  const [pdfVersion, setPdfVersion] = useState(0);
  const [fitMode, setFitMode] = useState<"page" | "width">("width");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;

    async function loadPdf() {
      setLoading(true);
      setError("");
      setPageNumber(1);
      setPageInput("");
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

  // Pages-per-sheet grid: same layout math as agent/print-image.ps1 — cols is
  // the ceiling square root, pages fill row-major, each page fits its cell.
  const pps = Math.max(1, sim?.pagesPerSheet ?? 1);
  const sheetCount = Math.max(1, Math.ceil(pageCount / pps));

  useEffect(() => {
    let disposed = false;

    async function renderSheet() {
      if (!pdfRef.current || !canvasRef.current) return;
      setLoading(true);
      try {
        renderTaskRef.current?.cancel();
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;

        const containerWidth = Math.max((containerRef.current?.clientWidth ?? 320) - 24, 240);
        const containerHeight = Math.max((containerRef.current?.clientHeight ?? 400) - 24, 300);

        // Sheet aspect from paper size + orientation. Without sim, fall back
        // to the first page's own aspect (plain document view).
        let [mmW, mmH] = PAPER_MM[sim?.paperSize ?? "A4"] ?? PAPER_MM.A4;
        if (sim?.layout === "landscape") [mmW, mmH] = [mmH, mmW];

        let sheetW = containerWidth;
        let sheetH = (sheetW * mmH) / mmW;
        if (fitMode === "page" && sheetH > containerHeight) {
          sheetH = containerHeight;
          sheetW = (sheetH * mmW) / mmH;
        }

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(sheetW * pixelRatio);
        canvas.height = Math.floor(sheetH * pixelRatio);
        canvas.style.width = `${Math.floor(sheetW)}px`;
        canvas.style.height = `${Math.floor(sheetH)}px`;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        // White sheet of paper.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, sheetW, sheetH);

        const marginPx = sheetW * (MARGIN_FRACTION[sim?.margins ?? "default"] ?? 0.05);
        const areaX = marginPx, areaY = marginPx;
        const areaW = sheetW - 2 * marginPx, areaH = sheetH - 2 * marginPx;

        const cols = Math.ceil(Math.sqrt(pps));
        const rows = Math.ceil(pps / cols);
        const cellW = areaW / cols, cellH = areaH / rows;

        const firstPage = (pageNumber - 1) * pps + 1;
        for (let n = 0; n < pps; n++) {
          const pageIdx = firstPage + n;
          if (pageIdx > pageCount) break;
          const page = await pdfRef.current.getPage(pageIdx);
          if (disposed) return;

          const vp1 = page.getViewport({ scale: 1 });
          const fit = Math.min(cellW / vp1.width, cellH / vp1.height);
          const vp = page.getViewport({ scale: Math.max(0.1, fit) * pixelRatio });

          const off = document.createElement("canvas");
          off.width = Math.max(1, Math.floor(vp.width));
          off.height = Math.max(1, Math.floor(vp.height));
          const offCtx = off.getContext("2d");
          if (!offCtx) continue;
          const renderTask = page.render({ canvasContext: offCtx, viewport: vp });
          renderTaskRef.current = renderTask;
          await renderTask.promise;
          if (disposed) return;

          const drawW = vp.width / pixelRatio, drawH = vp.height / pixelRatio;
          const col = n % cols, row = Math.floor(n / cols);
          const x = areaX + col * cellW + (cellW - drawW) / 2;
          const y = areaY + row * cellH + (cellH - drawH) / 2;
          context.drawImage(off, x, y, drawW, drawH);
          // Faint page outline so multiple pages per sheet read clearly.
          if (pps > 1) {
            context.strokeStyle = "rgba(0,0,0,0.12)";
            context.strokeRect(x, y, drawW, drawH);
          }
        }
      } catch (err) {
        if (!disposed && !(err instanceof Error && err.name === "RenderingCancelledException")) {
          setError("Unable to render this PDF page.");
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    renderSheet();

    return () => {
      disposed = true;
      renderTaskRef.current?.cancel();
    };
  }, [pageNumber, pdfVersion, fitMode, pps, sim?.layout, sim?.paperSize, sim?.margins, pageCount]);

  // Keep the sheet cursor valid when pages-per-sheet (and thus sheet count) changes.
  useEffect(() => {
    if (pageNumber > sheetCount) setPageNumber(sheetCount);
  }, [sheetCount, pageNumber]);

  function handlePageJump() {
    const num = parseInt(pageInput, 10);
    if (Number.isFinite(num) && num >= 1 && num <= sheetCount) {
      setPageNumber(num);
      setPageInput("");
    }
  }

  function handlePageInputKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handlePageJump();
  }

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
        <div className="pdfjs-pagination">
          <button type="button" onClick={() => setPageNumber((page) => Math.max(1, page - 1))} disabled={pageNumber <= 1} aria-label="Previous PDF page" className="pdfjs-nav-btn">
            <ArrowLeft size={18} />
          </button>
          <div className="pdfjs-page-jump">
            <span className="pdfjs-page-label">{pps > 1 ? "Sheet" : "Page"}</span>
            <input
              type="number"
              min="1"
              max={sheetCount}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={handlePageInputKey}
              onBlur={handlePageJump}
              placeholder={String(pageNumber)}
              aria-label={pps > 1 ? "Jump to sheet" : "Jump to page"}
              className="pdfjs-page-input"
            />
            <span className="pdfjs-page-of">of</span>
            <span className="pdfjs-page-total">{sheetCount}</span>
          </div>
          <button type="button" onClick={() => setPageNumber((page) => Math.min(sheetCount, page + 1))} disabled={pageNumber >= sheetCount} aria-label="Next PDF page" className="pdfjs-nav-btn">
            <ArrowRight size={18} />
          </button>
        </div>
        
        <div className="pdfjs-zoom-controls">
          <button
            type="button"
            className={`pdfjs-fit-btn ${fitMode === "width" ? "active" : ""}`}
            onClick={() => setFitMode("width")}
            aria-label="Fit to width"
            title="Fit to width"
          >
            <Maximize2 size={16} />
          </button>
          <button
            type="button"
            className={`pdfjs-fit-btn ${fitMode === "page" ? "active" : ""}`}
            onClick={() => setFitMode("page")}
            aria-label="Fit to page"
            title="Fit to page"
          >
            <Minimize2 size={16} />
          </button>
        </div>
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

// Tiny first-page thumbnail for a bulk-selected PDF. Renders once per file at a
// fixed small width; falls back to the generic file icon if pdf.js can't render
// on this device (the file still uploads and prints fine).
function BulkThumb({ file, grayscale }: { file: File; grayscale: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let pdf: { destroy: () => Promise<void> | void } | null = null;

    async function renderThumb() {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const data = await file.arrayBuffer();
        const loaded = await pdfjs.getDocument({
          data: new Uint8Array(data),
          disableFontFace: true,
          isEvalSupported: false,
          useWorkerFetch: false,
        } as unknown as Parameters<typeof pdfjs.getDocument>[0]).promise;
        if (disposed) { await loaded.destroy(); return; }
        pdf = loaded;
        const page = await loaded.getPage(1);
        const canvas = canvasRef.current;
        if (disposed || !canvas) return;
        const base = page.getViewport({ scale: 1 });
        const scale = 44 / base.width; // ~44px wide thumb
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
  }, [file]);

  if (failed) return <FileText size={18} aria-hidden="true" />;
  return <canvas ref={canvasRef} className={`bulk-thumb ${grayscale ? "bw-sim-img" : ""}`} aria-hidden="true" />;
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
