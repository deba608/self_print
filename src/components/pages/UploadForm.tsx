"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { UploadCloud, FileText, Image, ArrowLeft, ArrowRight, Check, Eye, Loader2, File, Settings2, Printer, Copy, Store, X, Search, CreditCard, RefreshCw, Info, Truck, MapPin, Navigation } from "lucide-react";
import { formatRupees, paperSizeLabels, allPaperSizes } from "@/lib/pricing";
import { estimatePdfPages } from "@/lib/pdf-pages";

import BulkThumb from "../upload/BulkThumb";
import PdfCanvasPreview from "../upload/PdfCanvasPreview";
import ResultScreen from "../upload/ResultScreen";
import { estimateRange, type Pricing } from "../upload/shared";

type Step = "upload" | "settings" | "preview" | "converting" | "done" | "docx-warning";
type PageRangeMode = "all" | "custom";

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
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "delivery">("pickup");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState<{
    latitude: number;
    longitude: number;
    accuracyMeters: number;
  } | null>(null);
  const [locationState, setLocationState] = useState<"idle" | "locating" | "captured">("idle");
  const [locationError, setLocationError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Direction-aware step transition: forward navigation slides in from the
  // right, backward from the left. Keyed on `step` so the animation replays.
  const stepAnimRef = useRef("fade-in");
  const prevStepRef = useRef<Step>("upload");
  if (prevStepRef.current !== step) {
    const order: Record<Step, number> = { upload: 0, "docx-warning": 0, settings: 1, preview: 2, converting: 3, done: 3 };
    stepAnimRef.current = order[step] >= order[prevStepRef.current] ? "slide-fwd" : "slide-back";
    prevStepRef.current = step;
  }
  const stepAnim = stepAnimRef.current;
  // Desktop one-page mode: at >=1024px the Settings and Preview steps merge
  // into one two-column workspace (settings left, live preview + confirm
  // right) — the wizard only exists on smaller screens. SSR renders the
  // mobile wizard; the effect corrects on mount before first paint matters.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  // Desktop fulfillment stage — the workspace's Continue button flips to a
  // dedicated "how will you get your prints?" screen before submitting.
  const [fulfilStage, setFulfilStage] = useState(false);
  useEffect(() => {
    // Leaving the workspace (new upload, done, resize to mobile) always
    // resets to the first stage.
    if (step !== "settings" && step !== "preview") setFulfilStage(false);
  }, [step]);
  useEffect(() => {
    if (!isDesktop) setFulfilStage(false);
  }, [isDesktop]);
  const [filePageCount, setFilePageCount] = useState<number | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkPageCounts, setBulkPageCounts] = useState<number[]>([]);
  // Stable per-file ids, kept index-aligned with bulkFiles/bulkPageCounts and
  // used to key the upload promises (see bulkUploadsRef) so storedName↔file
  // alignment survives any removal, independent of positional index.
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  // Ids currently animating out (X clicked); actual removal happens on
  // transition-end so the collapse always plays against the correct file.
  const [leavingBulkIds, setLeavingBulkIds] = useState<Set<string>>(new Set());
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
  const uploadPromiseRef = useRef<Promise<{ isDirectUpload: boolean; storedName?: string; uploadSig?: string; error?: string }> | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  // Upload promises keyed by stable file id (all fed by a single shared
  // /api/uploads/sign call, see startBulkUploads). Keyed by id — not array
  // index — so removeBulkFile can drop one entry without any index desync.
  const bulkUploadsRef = useRef<Map<string, Promise<{ storedName?: string; uploadSig?: string; error?: string; fallback?: boolean }>> | null>(null);
  const bulkUploadAbortControllerRef = useRef<AbortController | null>(null);

  const isBulk = bulkMode;
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // PUTs a file straight to a signed storage URL via XHR (fetch has no upload
  // progress events). The signed URL is absolute and carries its own token, so
  // this needs NO client-side Supabase config — works on any deployment where
  // the server has cloud storage.
  function xhrPutFile(
    url: string,
    file: File,
    onProgress: (loaded: number) => void,
    signal: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const onAbort = () => xhr.abort();
      signal.addEventListener("abort", onAbort);
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded);
      };
      xhr.onload = () => {
        signal.removeEventListener("abort", onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(file.size);
          resolve();
        } else {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => {
        signal.removeEventListener("abort", onAbort);
        reject(new Error("Upload failed — check your connection."));
      };
      xhr.onabort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
      };
      xhr.send(file);
    });
  }

  // Overall upload progress across the current batch (0-100).
  const uploadedBytesRef = useRef<Map<string, number>>(new Map());
  const [uploadPct, setUploadPct] = useState(0);

  function reportProgress(id: string, loaded: number, totalBytes: number) {
    uploadedBytesRef.current.set(id, loaded);
    let sum = 0;
    for (const v of uploadedBytesRef.current.values()) sum += v;
    setUploadPct(totalBytes > 0 ? Math.min(100, Math.round((sum / totalBytes) * 100)) : 0);
  }

  // Starts one shared sign request for the whole batch, then PUTs each file
  // directly to storage with progress. Falls back to sending bytes with the
  // job form ONLY when the server has no cloud storage (local SQLite mode —
  // the sign endpoint answers 400 "Direct upload not available").
  function startBulkUploads(selected: File[], ids: string[]): Map<string, Promise<{ storedName?: string; uploadSig?: string; error?: string; fallback?: boolean }>> {
    if (bulkUploadAbortControllerRef.current) {
      bulkUploadAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    bulkUploadAbortControllerRef.current = controller;

    uploadedBytesRef.current = new Map();
    setUploadPct(0);
    const totalBytes = selected.reduce((s, f) => s + f.size, 0);

    const map = new Map<string, Promise<{ storedName?: string; uploadSig?: string; error?: string; fallback?: boolean }>>();

    const signPromise: Promise<Array<{ signedUrl: string; token: string; storedName: string; uploadSig: string }> | "fallback"> = fetch("/api/uploads/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: selected.map((f) => ({ fileName: f.name, mimeType: f.type, sizeBytes: f.size })) }),
      signal: controller.signal,
    }).then(async (res) => {
      const signBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (String(signBody.error ?? "").includes("not available")) return "fallback" as const;
        throw new Error(signBody.error ?? "Could not start upload.");
      }
      return signBody.uploads as Array<{ signedUrl: string; token: string; storedName: string; uploadSig: string }>;
    });

    selected.forEach((file, i) => {
      map.set(ids[i], signPromise
        .then(async (uploads) => {
          if (uploads === "fallback") return { fallback: true };
          const u = uploads[i];
          await xhrPutFile(u.signedUrl, file, (loaded) => reportProgress(ids[i], loaded, totalBytes), controller.signal);
          return { storedName: u.storedName, uploadSig: u.uploadSig };
        })
        .catch((err) => {
          if (err?.name === "AbortError") return { error: "Aborted" };
          return { error: err instanceof Error ? `Upload failed for ${file.name}: ${err.message}` : "Upload failed" };
        })
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

    uploadedBytesRef.current = new Map();
    setUploadPct(0);

    try {
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: selectedFile.name, mimeType: selectedFile.type, sizeBytes: selectedFile.size }),
        signal: controller.signal,
      });
      const signBody = await signRes.json().catch(() => ({}));
      if (!signRes.ok) {
        // Server has no cloud storage — send the file bytes with the job form.
        if (String(signBody.error ?? "").includes("not available")) return { isDirectUpload: false };
        throw new Error(signBody.error ?? "Could not start upload.");
      }

      await xhrPutFile(
        signBody.signedUrl,
        selectedFile,
        (loaded) => reportProgress("single", loaded, selectedFile.size),
        controller.signal
      );

      return { isDirectUpload: true, storedName: signBody.storedName, uploadSig: signBody.uploadSig };
    } catch (err: any) {
      if (err.name === "AbortError") throw err;
      return { isDirectUpload: true, error: err instanceof Error ? err.message : "Upload failed" };
    }
  }

  // Remembered token for the "recent order" chip on the upload step, and
  // saving the current order's token once it exists — both power /track.
  const [recentToken, setRecentToken] = useState<string | null>(null);
  useEffect(() => {
    try { setRecentToken(localStorage.getItem("selfprint:lastToken")); } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    if (!result?.token) return;
    try { localStorage.setItem("selfprint:lastToken", result.token); } catch { /* private mode */ }
    setRecentToken(result.token);
  }, [result]);

  useEffect(() => {
    fetch("/api/pricing")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setPricing(data); })
      .catch(() => {});
  }, []);

  // Repeat-print: remembers the last successful job's settings so a
  // returning customer can apply them with one tap instead of re-picking
  // print type, copies, paper size, etc. every visit.
  type LastSettings = {
    printType: string; copies: number; paperSize: string; layout: string;
    scale: string; margins: string; pagesPerSheet: number; duplex: string;
  };
  const LAST_SETTINGS_KEY = "selfprint:lastSettings";
  const [lastSettings, setLastSettings] = useState<LastSettings | null>(null);
  const [appliedLastSettings, setAppliedLastSettings] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_SETTINGS_KEY);
      if (raw) setLastSettings(JSON.parse(raw));
    } catch { /* private mode or malformed value */ }
  }, []);

  function saveLastSettings() {
    const s: LastSettings = { printType, copies, paperSize, layout, scale, margins, pagesPerSheet, duplex };
    try { localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  }

  function applyLastSettings() {
    if (!lastSettings) return;
    setPrintType(lastSettings.printType);
    setCopies(lastSettings.copies);
    setPaperSize(lastSettings.paperSize);
    setLayout(lastSettings.layout);
    setScale(lastSettings.scale);
    setMargins(lastSettings.margins);
    setPagesPerSheet(lastSettings.pagesPerSheet);
    setDuplex(lastSettings.duplex);
    setAppliedLastSettings(true);
  }

  const lastSettingsSummary = lastSettings
    ? `${lastSettings.printType === "bw" ? "B&W" : "Color"} · ${lastSettings.paperSize} · ${lastSettings.copies} ${lastSettings.copies === 1 ? "copy" : "copies"}`
    : "";

  const effectivePageRange = useMemo(() => {
    if (pageRangeMode === "all") return "";
    return customPageRange;
  }, [pageRangeMode, customPageRange]);

  const selectedPages = useMemo(() => {
    const totalPages = filePageCount ?? 1;
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

  // DOC/DOCX files need conversion before printing, and converted jobs can't
  // pay online (see result.needsConversion gating below) — but delivery orders
  // require online payment. So delivery is never offered for a doc/docx file.
  const isDocFile = Boolean(file && (file.name.toLowerCase().endsWith(".doc") || file.name.toLowerCase().endsWith(".docx")));

  // Without a UPI link or a Razorpay key configured there is no online payment
  // rail at all, so a delivery order (which must pay online) could never be
  // settled — hide the delivery option entirely in that case.
  const onlinePaymentRailAvailable = Boolean(
    (pricing?.shopUpiId ?? "").trim() || (pricing?.shopUpiQr ?? "").trim() || (pricing?.razorpayKeyId ?? "").trim()
  );

  const deliveryOfferable = !isDocFile && onlinePaymentRailAvailable;

  useEffect(() => {
    if (!deliveryOfferable && deliveryMethod === "delivery") {
      setDeliveryMethod("pickup");
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
      setDeliveryLocation(null);
      setLocationState("idle");
      setLocationError("");
    }
  }, [deliveryOfferable, deliveryMethod]);

  function captureDeliveryLocation() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("Location access is not supported on this device. Your written address will still be used.");
      return;
    }
    setLocationState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeliveryLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Math.round(position.coords.accuracy),
        });
        setLocationState("captured");
      },
      (geoError) => {
        setLocationState("idle");
        setLocationError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location permission was denied. You can continue with the written address."
            : "We could not get your location. Move near a window and try again, or continue with the written address."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function appendDeliveryDetails(form: FormData) {
    form.set("deliveryMethod", deliveryMethod);
    if (deliveryMethod !== "delivery") return;
    form.set("customerName", customerName.trim());
    form.set("customerPhone", customerPhone);
    form.set("deliveryAddress", deliveryAddress.trim());
    if (deliveryLocation) {
      form.set("deliveryLatitude", String(deliveryLocation.latitude));
      form.set("deliveryLongitude", String(deliveryLocation.longitude));
      form.set("deliveryAccuracyMeters", String(deliveryLocation.accuracyMeters));
    }
  }

  const estimate = useMemo(() => {
    if (!pricing) return 0;
    // Bulk mode has no page-range selector — price off the summed page count
    // across the whole batch instead of the single-file selectedPages.
    const pages = isBulk ? bulkTotalPages : selectedPages;
    if (paperSize === "Photo") {
      // Round to whole paise exactly like the server (calculatePrice) so the
      // estimate never drifts a paisa from the final charged amount.
      return Math.round(pricing.photoPrintPaise * copies) / 100 + (deliveryMethod === "delivery" ? pricing.deliveryFeePaise / 100 : 0);
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
    const printCost = Math.round(pageCostSum * copies * paperMultiplier * pricing.copyMultiplier) / 100;
    const deliveryFee = deliveryMethod === "delivery" ? pricing.deliveryFeePaise / 100 : 0;
    return printCost + deliveryFee;
  }, [copies, selectedPages, paperSize, printType, pricing, duplex, isBulk, bulkTotalPages, deliveryMethod]);

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

  // Actual page numbers the print will include (1-based, sorted), mirroring the
  // agent's parsePageRange. null = all pages — also while a custom range is
  // empty or invalid, so the preview never goes blank mid-typing.
  const selectedPageList = useMemo<number[] | null>(() => {
    const total = filePageCount ?? 0;
    if (!total || pageRangeMode === "all") return null;
    if (!customPageRange.trim() || !isValidPageRange) return null;
    const pages = new Set<number>();
    for (const part of customPageRange.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const [startRaw, endRaw] = trimmed.split("-");
      const start = parseInt(startRaw, 10);
      const end = endRaw ? parseInt(endRaw, 10) : start;
      if (isNaN(start) || isNaN(end)) continue;
      for (let p = Math.max(1, start); p <= Math.min(total, end); p++) pages.add(p);
    }
    return pages.size ? [...pages].sort((a, b) => a - b) : null;
  }, [filePageCount, pageRangeMode, customPageRange, isValidPageRange]);

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

    // Preserve delivery details when a single PDF becomes a batch.

    const ids = selected.map(() => crypto.randomUUID());
    setBulkFiles(selected);
    setBulkIds(ids);
    setBulkMode(true);
    setBulkPreviewIndex(0);
    // Show the settings step IMMEDIATELY — counting pages means reading every
    // file, which takes seconds for large PDFs. Placeholder 1s now; real
    // counts patch in when ready (guarded so a newer selection isn't clobbered).
    setBulkPageCounts(selected.map(() => 1));
    Promise.all(selected.map((f) => estimatePdfPages(f))).then((counts) => {
      setBulkIds((currentIds) => {
        if (currentIds.length === ids.length && currentIds.every((v, i) => v === ids[i])) {
          setBulkPageCounts(counts);
        }
        return currentIds;
      });
    });
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
        // Count pages in the background — reading a large PDF takes seconds
        // and must not block the step transition. UI shows "All pages" until
        // the count lands (filePageCount stays null meanwhile).
        estimatePdfPages(selectedFile).then((pages) => {
          setFile((current) => {
            if (current === selectedFile) setFilePageCount(pages);
            return current;
          });
        });
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
    setError("");
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

  function swapBulkFiles(from: number, to: number) {
    setBulkFiles((prev) => { const arr = [...prev]; [arr[from], arr[to]] = [arr[to], arr[from]]; return arr; });
    setBulkPageCounts((prev) => { const arr = [...prev]; [arr[from], arr[to]] = [arr[to], arr[from]]; return arr; });
    setBulkIds((prev) => { const arr = [...prev]; [arr[from], arr[to]] = [arr[to], arr[from]]; return arr; });
    setBulkPreviewIndex((prev) => prev === from ? to : prev === to ? from : prev);
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
      const missing: Promise<{ storedName?: string; uploadSig?: string; error?: string; fallback?: boolean }> = Promise.resolve({ error: "Upload was not started for this file." });
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
      appendDeliveryDetails(bulkForm);

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
            uploadSig: uploadResults[i]?.uploadSig ?? "",
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

      saveLastSettings();
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
    appendDeliveryDetails(form);

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
          form.set("uploadSig", uploadResult.uploadSig ?? "");
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
        saveLastSettings();
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
    if (deliveryMethod === "delivery" && (!customerName.trim() || !/^\d{10}$/.test(customerPhone) || !deliveryAddress.trim())) {
      setError("Enter your name, a 10-digit phone number, and delivery address.");
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
    setDeliveryMethod("pickup");
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
    setDeliveryLocation(null);
    setLocationState("idle");
    setLocationError("");
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
    // Everything payment/receipt/live-status related lives in ResultScreen —
    // its own state resets automatically when this unmounts (Upload Another).
    const billFiles = isBulk
      ? bulkFiles.map((f, i) => ({ name: f.name, pages: bulkPageCounts[i] ?? 1 }))
      : [{ name: file?.name ?? "Document", pages: result.pageCount || filePageCount || 1 }];
    return (
      <ResultScreen
        result={result}
        pricing={pricing}
        deliveryMethod={deliveryMethod}
        billFiles={billFiles}
        settings={{ printType, duplex, paperSize, copies, pagesPerSheet }}
        onReset={resetForm}
      />
    );
  }



  // Desktop one-page workspace: both the settings and preview blocks render
  // side by side; the wizard's step value stays wherever it was (mobile
  // resize mid-flow keeps working) but no longer gates what's visible.
  const onePage = isDesktop && (step === "settings" || step === "preview");
  const showSettings = step === "settings" || (onePage && step === "preview");
  const showPreview = step === "preview" || (onePage && step === "settings");
  // Same validity rule the Preview button uses on mobile — in one-page mode
  // it gates Confirm directly since there is no intermediate Preview click.
  const settingsInvalid =
    (pageRangeMode === "custom" && !!customPageRange.trim() && !isValidPageRange) || isDuplexInvalid;

  return (
    <div className="upload-form">
      {/* Intro copy — only makes sense on the upload screen itself; once the
          customer has a file in and is deep in settings/preview it's just
          dead weight pushing the actual controls further down. */}
      {step === "upload" && (
        <div className="intro intro-anim">
          <h1>Print Your Files</h1>
          <p className="muted">Upload from your phone, get a token, pay at the counter, and collect your print.</p>
        </div>
      )}

      {/* Step indicator — hidden in the desktop one-page workspace, where
          there are no steps to indicate — on desktop the flow is just
          "pick a file → everything on one screen", so the 3-step wizard
          indicator would be lying even on the upload screen. */}
      {!isDesktop && (
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
      )}

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className={`step-content ${stepAnim}`} key={step}>
          <div
            className={`upload-zone ${file ? "has-file" : ""} ${dragOver ? "drag-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = e.dataTransfer?.files;
              if (dropped?.length) {
                handleFileChange({ target: { files: dropped } } as unknown as React.ChangeEvent<HTMLInputElement>);
              }
            }}
          >
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
              <strong>Tap or drag & drop files here</strong>
              <span className="muted">PDF, JPG, PNG up to 25MB · or drag 2-10 PDFs at once</span>
            </label>
          </div>
          <div className="supported-formats">
            <span className="format-badge">PDF</span>
            <span className="format-badge">JPG</span>
            <span className="format-badge">PNG</span>
          </div>

          {recentToken && (
            <div className="track-link-row">
              <a className="recent-order-chip" href={`/track?token=${recentToken}`}>
                <Search size={14} aria-hidden="true" />
                Recent order #{recentToken} — track it
              </a>
            </div>
          )}
          {error && (
            <div className="error-msg" role="alert">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Step 1.5: DOCX Warning */}
      {step === "docx-warning" && (
        <div className={`step-content ${stepAnim}`} key={step}>
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
                onClick={() => { setError(""); setStep("upload"); }}
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

      {/* Steps 2+3 — a wizard on mobile, one two-column workspace on
          desktop (settings left, live preview + confirm right). */}
      <div className={onePage ? `flow-grid${fulfilStage ? " fulfil-stage" : ""}` : "flow-stack"}>

      {/* Step 2: Settings — children are grouped into three zones so the
          desktop one-page grid can place them (file top-left, settings
          bottom-left, fulfillment+price bottom-right) while mobile just
          stacks the same zones in order. */}
      {showSettings && (
        <div className={`step-content ${onePage ? "flow-contents" : stepAnim}`} key="block-settings">
          <div className="fs-file-zone">

          {/* Hidden add-more input — shared by the mobile button and the
              desktop "+ Add more" tile. */}
          {(isBulk || file?.type === "application/pdf") && (
            <input
              ref={addMoreInputRef}
              type="file"
              id="add-more-input"
              multiple
              accept=".pdf,application/pdf"
              onChange={handleAddMoreFiles}
              style={{ display: "none" }}
            />
          )}

          {onePage ? (
            /* Desktop: files as thumbnail cards (click = preview it,
               × = remove) plus an add-more tile — no summary chip. */
            <div className="file-zone-board">
              <h3 className="file-zone-title">
                Your files
                {isBulk && <span className="file-zone-count">{bulkFiles.length}/10 · {bulkTotalPages} pages</span>}
              </h3>
              <div className="file-thumb-grid">
                {isBulk ? (
                  bulkFiles.map((f, i) => (
                    <div
                      key={bulkIds[i] ?? i}
                      className={`file-thumb-card ${i === bulkPreviewIndex ? "active" : ""} ${dragOverIndex === i ? "drag-over" : ""}`}
                      draggable={bulkFiles.length > 1}
                      role="button"
                      tabIndex={0}
                      aria-label={`Preview ${f.name}`}
                      aria-pressed={i === bulkPreviewIndex}
                      onClick={() => setBulkPreviewIndex(i)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBulkPreviewIndex(i); } }}
                      onDragStart={(e) => { dragIndexRef.current = i; e.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIndex(i); }}
                      onDragLeave={() => { if (dragOverIndex === i) setDragOverIndex(null); }}
                      onDrop={(e) => { e.preventDefault(); const from = dragIndexRef.current; if (from !== null && from !== i) swapBulkFiles(from, i); dragIndexRef.current = null; setDragOverIndex(null); }}
                      onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}
                    >
                      <BulkThumb file={f} grayscale={printType === "bw"} width={82} />
                      <span className="file-thumb-name" title={f.name}>{f.name}</span>
                      <span className="file-thumb-pages">{bulkPageCounts[i] ?? 1} pg</span>
                      <button
                        type="button"
                        className="file-thumb-remove"
                        aria-label={`Remove ${f.name}`}
                        onClick={(e) => { e.stopPropagation(); removeBulkFile(i); }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))
                ) : file && (
                  <div className="file-thumb-card active">
                    {file.type === "application/pdf" ? (
                      <BulkThumb file={file} grayscale={printType === "bw"} width={82} />
                    ) : previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewUrl} alt="" className="file-thumb-img" />
                    ) : (
                      <File size={40} aria-hidden="true" />
                    )}
                    <span className="file-thumb-name" title={file.name}>{file.name}</span>
                    {file.type === "application/pdf" && filePageCount ? (
                      <span className="file-thumb-pages">{filePageCount} pg</span>
                    ) : null}
                    <button
                      type="button"
                      className="file-thumb-remove"
                      aria-label="Remove file and choose another"
                      onClick={() => {
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
                        setError("");
                        if (fileInputRef.current) fileInputRef.current.value = "";
                        setStep("upload");
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                )}
                {(isBulk || file?.type === "application/pdf") && (
                  <button
                    type="button"
                    className="file-thumb-add"
                    onClick={() => addMoreInputRef.current?.click()}
                    disabled={isBulk && bulkFiles.length >= 10}
                    title={isBulk && bulkFiles.length >= 10 ? "Maximum 10 files per job" : "Add more PDFs to this job (click or drag files here)"}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = e.dataTransfer?.files;
                      if (dropped?.length) {
                        handleAddMoreFiles({ target: { files: dropped } } as unknown as React.ChangeEvent<HTMLInputElement>);
                      }
                    }}
                  >
                    <UploadCloud size={22} aria-hidden="true" />
                    Add more
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
          {/* File summary */}
          {isBulk ? (
            <button
              className="file-summary"
              onClick={() => {
                if (bulkUploadAbortControllerRef.current) {
                  bulkUploadAbortControllerRef.current.abort();
                  bulkUploadAbortControllerRef.current = null;
                }
                bulkUploadsRef.current = null;
                setBulkFiles([]);
                setBulkPageCounts([]);
                setBulkIds([]);
                setBulkMode(false);
                setBulkUploading(false);
                setError("");
                if (fileInputRef.current) fileInputRef.current.value = "";
                setStep("upload");
              }}
              aria-label="Change files"
            >
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
            <button
              className="file-summary"
              onClick={() => {
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
                setError("");
                if (fileInputRef.current) fileInputRef.current.value = "";
                setStep("upload");
              }}
              aria-label="Change file"
            >
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
          )}

          {/* Repeat-print: one tap reapplies the last successful job's settings */}
          {lastSettings && !appliedLastSettings && (
            <button type="button" className="repeat-settings-chip" onClick={applyLastSettings}>
              <RefreshCw size={14} aria-hidden="true" />
              <span>Use same as last time</span>
              <span className="repeat-settings-sub">{lastSettingsSummary}</span>
            </button>
          )}
            </>
          )}

          {/* Live upload progress — large files take a while on mobile data */}
          {(isBulk ? bulkUploading : uploadPct > 0 && uploadPct < 100) && (
            <div className="upload-progress" role="progressbar" aria-valuenow={uploadPct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
              <div className="upload-progress-track">
                <div className="upload-progress-fill" style={{ width: `${uploadPct}%` }} />
              </div>
              <span className="upload-progress-label">Uploading… {uploadPct}%</span>
            </div>
          )}

          </div>{/* /fs-file-zone */}

          <div className="fs-settings compact-settings">
          <h3 className="settings-heading">Print Settings</h3>
          {/* Print type toggle */}
          <div className="print-type-toggle">
            <button
              type="button"
              className={`toggle-btn ${printType === "bw" ? "active" : ""}`}
              onClick={() => setPrintType("bw")}
              aria-pressed={printType === "bw"}
            >
              <span className="toggle-label">Black & White</span>
              {pricing && <span className="toggle-price">{formatRupees(pricing.bwPerPagePaise)}/pg</span>}
            </button>
            <button
              type="button"
              className={`toggle-btn color-btn ${printType === "color" ? "active" : ""}`}
              onClick={() => setPrintType("color")}
              aria-pressed={printType === "color"}
            >
              <span className="toggle-label">Color</span>
              {pricing && <span className="toggle-price">{formatRupees(pricing.colorPerPagePaise)}/pg</span>}
            </button>
          </div>

          {/* Sides — right after print type */}
          <div className="form-group">
            <label id="sides-label">Sides</label>
            <div className="page-mode-grid" role="group" aria-labelledby="sides-label">
              <button
                type="button"
                className={`page-mode-btn ${duplex === "simplex" ? "active" : ""}`}
                onClick={() => setDuplex("simplex")}
                aria-pressed={duplex === "simplex"}
              >
                <FileText size={18} className="page-mode-icon" aria-hidden="true" />
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
                <Copy size={18} className="page-mode-icon" aria-hidden="true" />
                <span className="page-mode-label">Double-sided</span>
              </button>
            </div>
            {!canDuplex && (
              <span className="range-hint" style={{ marginTop: "0.25rem", display: "block" }}>
                Double-sided needs a document with at least 2 pages.
              </span>
            )}
          </div>

          {/* Page Range — not applicable in bulk mode */}
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
                    <File size={18} className="page-mode-icon" aria-hidden="true" />
                    <span className="page-mode-label">All Pages</span>
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

          {/* Copies + Paper Size */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="copies-input">Copies</label>
              <div className="number-input">
                <button
                  type="button"
                  className="num-btn"
                  onClick={() => setCopies(Math.max(1, copies - 1))}
                  aria-label="Decrease copies"
                ><span>-</span></button>
                <input
                  id="copies-input"
                  type="number"
                  min="1" max="99" step="1"
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
                ><span>+</span></button>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="paper-size">Paper</label>
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
          </div>

          {/* Layout, scale, margins, pages/sheet — most orders use the
              defaults, so these live behind a closed disclosure and only
              surface for the customer who actually needs to change them. */}
          <details className="advanced-settings">
            <summary className="advanced-settings-summary">Advanced options</summary>
            <div className="advanced-settings-body">
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

          </div>{/* /fs-settings */}

          <div className="fs-fulfil">
          {/* Desktop stage 2 header — this zone becomes its own page. */}
          {onePage && fulfilStage && (
            <div className="fulfil-page-head">
              <button
                type="button"
                className="fulfil-back-btn"
                onClick={() => setFulfilStage(false)}
                aria-label="Back to print settings"
              >
                <ArrowLeft size={16} aria-hidden="true" /> Back to settings
              </button>
              <h3 className="fulfil-page-title">Almost done</h3>
            </div>
          )}
          {/* Fulfillment choice: on the desktop workspace this hides behind
              the Continue button (its own stage); mobile keeps it inline. */}
          {(!onePage || fulfilStage) && deliveryOfferable && (
            <div className="delivery-method-section">
              <h4 className="delivery-method-title">How will you get your prints?</h4>
              <div className="delivery-method-toggle" role="group" aria-label="Pickup or delivery">
                <button
                  type="button"
                  className={`delivery-method-btn ${deliveryMethod === "pickup" ? "active" : ""}`}
                  onClick={() => setDeliveryMethod("pickup")}
                  aria-pressed={deliveryMethod === "pickup"}
                >
                  <Store size={18} aria-hidden="true" />
                  Shop Pickup
                </button>
                <button
                  type="button"
                  className={`delivery-method-btn ${deliveryMethod === "delivery" ? "active" : ""}`}
                  onClick={() => setDeliveryMethod("delivery")}
                  aria-pressed={deliveryMethod === "delivery"}
                >
                  <Truck size={18} aria-hidden="true" />
                  Home Delivery
                  {pricing && pricing.deliveryFeePaise > 0 && (
                    <span className="delivery-fee-tag">+{formatRupees(pricing.deliveryFeePaise)}</span>
                  )}
                </button>
              </div>

              {deliveryMethod === "delivery" && (
                <div className="delivery-contact-fields">
                  <p className="delivery-pay-note">
                    <Info size={14} aria-hidden="true" />
                    Home delivery orders are paid online before printing.
                  </p>
                  <label className="delivery-field-label" htmlFor="delivery-name">Full name</label>
                  <input
                    id="delivery-name"
                    type="text"
                    placeholder="Full name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="delivery-input"
                    autoComplete="name"
                  />
                  <label className="delivery-field-label" htmlFor="delivery-phone">Phone</label>
                  <input
                    id="delivery-phone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="10-digit phone number"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className={`delivery-input ${customerPhone.length > 0 && customerPhone.length < 10 ? "delivery-input-invalid" : ""}`}
                    autoComplete="tel-national"
                    maxLength={10}
                    minLength={10}
                    pattern="[0-9]{10}"
                    title="Enter exactly 10 digits"
                  />
                  <label className="delivery-field-label" htmlFor="delivery-address">Delivery address</label>
                  <textarea
                    id="delivery-address"
                    placeholder="House/flat, street, area, landmark"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="delivery-input delivery-address-input"
                    rows={2}
                    autoComplete="street-address"
                  />
                  <div className={`delivery-location-card ${deliveryLocation ? "captured" : ""}`}>
                    <div className="delivery-location-copy">
                      <span className="delivery-location-icon" aria-hidden="true"><MapPin size={18} /></span>
                      <div>
                        <strong>Pin your delivery location</strong>
                        <p>
                          Optional, but recommended. Your device shares coordinates only after
                          you allow access; the written address stays required.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="delivery-location-btn"
                      onClick={captureDeliveryLocation}
                      disabled={locationState === "locating"}
                    >
                      {locationState === "locating" ? (
                        <><Loader2 size={16} className="spin" aria-hidden="true" /> Locating...</>
                      ) : deliveryLocation ? (
                        <><RefreshCw size={16} aria-hidden="true" /> Refresh location</>
                      ) : (
                        <><Navigation size={16} aria-hidden="true" /> Use my location</>
                      )}
                    </button>
                    <div className="delivery-location-feedback" aria-live="polite">
                      {deliveryLocation && (
                        <>
                          <span>Location captured with an accuracy radius of about {deliveryLocation.accuracyMeters} m.</span>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${deliveryLocation.latitude},${deliveryLocation.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Check map
                          </a>
                        </>
                      )}
                      {locationError && <span className="delivery-location-error">{locationError}</span>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Price box */}
          <div className="price-box">
            <div className="price-header">
              <span className="price-label">Estimated Price</span>
              <span key={estimate} className="price-value price-pop">{pricing ? `₹${estimate.toFixed(2)}` : "…"}</span>
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

          {/* Errors render once, in the fulfillment zone, in both modes. */}
          {error && (
            <div className="error-msg" role="alert">
              {error}
            </div>
          )}

          {/* One-page mode: workspace stage shows Continue (→ fulfillment
              page) when a fulfillment choice exists; the fulfillment page
              (or workspace when there's no choice to make) shows the real
              submit. Same validation as the wizard throughout. */}
          {onePage && deliveryOfferable && !fulfilStage ? (
            <button
              type="button"
              className="btn-primary btn-submit"
              onClick={() => {
                if (settingsInvalid) return;
                setError("");
                setFulfilStage(true);
              }}
              disabled={busy || (isBulk && bulkUploading) || settingsInvalid}
            >
              Continue <ArrowRight size={20} aria-hidden="true" />
            </button>
          ) : onePage && (
            <button
              type="button"
              className="btn-primary btn-submit"
              onClick={handleSubmit}
              disabled={busy || (isBulk && bulkUploading) || settingsInvalid}
              aria-busy={busy || (isBulk && bulkUploading)}
            >
              {busy ? (
                <><Loader2 size={20} className="spin" aria-hidden="true" /> Processing...</>
              ) : isBulk && bulkUploading ? (
                <><Loader2 size={20} className="spin" aria-hidden="true" /> Uploading files...</>
              ) : (
                deliveryMethod === "delivery"
                  ? <><CreditCard size={20} aria-hidden="true" /> Continue to Payment</>
                  : <><Check size={20} aria-hidden="true" /> Confirm Print</>
              )}
            </button>
          )}

          {/* Actions — the wizard's Back/Preview navigation; pointless in
              one-page mode where the preview is already on screen. */}
          {!onePage && (
          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setError(""); setStep("upload"); }}
              aria-label="Go back to upload step"
            >
              <ArrowLeft size={20} aria-hidden="true" /> Back
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={goToPreview}
              disabled={settingsInvalid}
              aria-label="Preview print settings"
            >
              Preview <Eye size={20} aria-hidden="true" />
            </button>
          </div>
          )}
          </div>{/* /fs-fulfil */}
        </div>
      )}

      {/* Step 3: Preview */}
      {showPreview && (
        <div className={`step-content ${onePage ? "flow-contents" : stepAnim}`} key="block-preview">
          <div className="preview-pane">
          <h3 className="preview-title">{onePage ? "Live Preview" : "Review Your Print Job"}</h3>

          {/* Preview area — grayscale simulation when printing B&W */}
          <div className={`preview-area ${printType === "bw" ? "bw-sim" : ""}`}>
            {isBulk && (
              <>
                {/* File management lives in the desktop file zone; this row
                    list is the mobile wizard's version only. */}
                {!onePage && (
                <div className="bulk-file-list">
                  {bulkFiles.map((f, i) => {
                    const id = bulkIds[i];
                    const isLeaving = id !== undefined && leavingBulkIds.has(id);
                    return (
                    <div
                      className={`bulk-file-row ${i === bulkPreviewIndex ? "active" : ""} ${isLeaving ? "leaving" : ""} ${dragOverIndex === i ? "drag-over" : ""}`}
                      key={id ?? i}
                      draggable={bulkFiles.length > 1}
                      role="button"
                      tabIndex={0}
                      aria-label={`Preview ${f.name}`}
                      aria-pressed={i === bulkPreviewIndex}
                      onClick={() => setBulkPreviewIndex(i)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setBulkPreviewIndex(i); } }}
                      onTransitionEnd={(e) => {
                        if (e.target !== e.currentTarget || e.propertyName !== "max-height") return;
                        if (id === undefined || !leavingBulkIds.has(id)) return;
                        removeBulkFile(bulkIds.indexOf(id));
                        setLeavingBulkIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
                      }}
                      onDragStart={(e) => { dragIndexRef.current = i; e.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIndex(i); }}
                      onDragLeave={() => { if (dragOverIndex === i) setDragOverIndex(null); }}
                      onDrop={(e) => { e.preventDefault(); const from = dragIndexRef.current; if (from !== null && from !== i) swapBulkFiles(from, i); dragIndexRef.current = null; setDragOverIndex(null); }}
                      onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null); }}
                    >
                      <BulkThumb file={f} grayscale={printType === "bw"} />
                      <span className="bulk-file-name">{f.name}</span>
                      <span className="bulk-file-pages">{bulkPageCounts[i] ?? 1} pg</span>
                      <button type="button" className="bulk-file-remove" aria-label={`Remove ${f.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (id === undefined) { removeBulkFile(i); return; }
                          setLeavingBulkIds((prev) => new Set(prev).add(id));
                        }}>
                        <X size={16} />
                      </button>
                    </div>
                    );
                  })}
                </div>
                )}
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
                sim={{ pagesPerSheet, layout, paperSize, margins, pages: selectedPageList }}
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

          {/* Settings summary — redundant in one-page mode where the live
              settings sit in the adjacent column; only the physical-output
              line survives there (rendered below). */}
          {!onePage && (
          <details className="settings-summary">
            <summary>
              <span className="summary-glance-title">Print Settings</span>
              <span className="summary-glance">
                {printType === "bw" ? "B&W" : "Color"} · {copies > 1 ? `${copies}× · ` : ""}
                {isBulk ? `${bulkTotalPages}p` : pageInfo} · {paperSizeLabels[paperSize as keyof typeof paperSizeLabels] || paperSize}
              </span>
            </summary>
            <div className="settings-summary-body">
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
            </div>{/* /settings-summary-body */}
          </details>
          )}

          {onePage && (
            <div className="summary-paper-note">
              <Printer size={14} aria-hidden="true" />
              Prints on {physicalSheets} sheet{physicalSheets === 1 ? "" : "s"} of paper
              {copies > 1 ? ` per copy (${physicalSheets * copies} total)` : ""}
            </div>
          )}
          </div>{/* /preview-pane */}

          {/* Everything below belongs to the wizard's review step only —
              in one-page mode fulfillment, totals, and Confirm live in the
              fs-fulfil zone instead. */}
          {!onePage && deliveryMethod === "delivery" && (
            <div className="delivery-review-card">
              <div className="delivery-review-heading">
                <Truck size={18} aria-hidden="true" />
                <div>
                  <h4>Home delivery</h4>
                  <p>Paid online before printing</p>
                </div>
              </div>
              <dl className="delivery-review-details">
                <div><dt>Customer</dt><dd>{customerName}</dd></div>
                <div><dt>Phone</dt><dd>{customerPhone}</dd></div>
                <div className="delivery-review-address"><dt>Address</dt><dd>{deliveryAddress}</dd></div>
                <div>
                  <dt>Map pin</dt>
                  <dd>
                    {deliveryLocation
                      ? `Captured (about ±${deliveryLocation.accuracyMeters} m)`
                      : "Not shared — written address will be used"}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* Total price */}
          {!onePage && (deliveryMethod === "delivery" && pricing ? (
            <div className="total-price-breakdown">
              <div className="total-price-row">
                <span>Printing</span>
                <span>₹{(estimate - pricing.deliveryFeePaise / 100).toFixed(2)}</span>
              </div>
              <div className="total-price-row">
                <span>Delivery</span>
                <span>{pricing.deliveryFeePaise > 0 ? `₹${(pricing.deliveryFeePaise / 100).toFixed(2)}` : "Free"}</span>
              </div>
              <div className="total-price">
                <span>Total</span>
                <strong>₹{estimate.toFixed(2)}</strong>
              </div>
            </div>
          ) : (
            <div className="total-price">
              <span>Total</span>
              <strong>{pricing ? `₹${estimate.toFixed(2)}` : "…"}</strong>
            </div>
          ))}

          {/* Submit errors must be visible HERE — Confirm lives on this step,
              and the settings-step error block is not rendered here. */}
          {!onePage && error && (
            <div className="error-msg" role="alert">
              {error}
            </div>
          )}

          {/* Actions */}
          {!onePage && (
          <div className="form-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setError(""); setStep("settings"); }}
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
                deliveryMethod === "delivery"
                  ? <><CreditCard size={20} aria-hidden="true" /> Continue to Payment</>
                  : <><Check size={20} aria-hidden="true" /> Confirm Print</>
              )}
            </button>
          </div>
          )}
        </div>
      )}

      </div>{/* /flow-grid | flow-stack */}

      {/* Help text */}
      {step !== "done" && (
        <p className="help-text">
          Need help? Ask the shop staff for assistance.
        </p>
      )}
    </div>
  );
}
