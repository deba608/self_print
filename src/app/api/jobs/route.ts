import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { MAX_BULK_FILES, parseBulkFiles } from "@/lib/bulk";
import { createJob, createJobWithFiles, getJobByToken, getPricing, nextQueuePosition } from "@/lib/db";
import { estimatePageCount, measureStoredFile, saveUpload, validateUpload } from "@/lib/files";
import { bucketPathFor, isValidStoredName, verifyStoredNameSig } from "@/lib/storage";
import { clientIp, isRateLimited } from "@/lib/ratelimit";
import { calculatePrice, calculateSpiralBindingPrice, effectiveDeliveryFeePaise, effectiveFileSettings, isAcceptingOrders, selectedPageCount } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";
import { checkDeliveryServiceable, isValidPincode } from "@/lib/service-area";
import type { FileSettingsOverride, PaperSize, PrintDuplex, PrintLayout, PrintMargins, PrintScale, PrintType } from "@/lib/types";

// Validates one bulk file's settings override against the same enums/ranges
// as the job-level fields. Returns null (meaning "no override", i.e. inherit
// job defaults) for an absent/empty entry, or an error string.
function validateFileOverride(raw: unknown): FileSettingsOverride | null | { error: string } {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return { error: "Invalid per-file settings." };
  const o = raw as Record<string, unknown>;
  const out: FileSettingsOverride = {};
  if (o.printType !== undefined) {
    if (!printTypes.includes(o.printType as PrintType)) return { error: "Invalid per-file print type." };
    out.printType = o.printType as PrintType;
  }
  if (o.duplex !== undefined) {
    if (!duplexOptions.includes(o.duplex as PrintDuplex)) return { error: "Invalid per-file duplex setting." };
    out.duplex = o.duplex as PrintDuplex;
  }
  if (o.paperSize !== undefined) {
    if (!paperSizes.includes(o.paperSize as PaperSize)) return { error: "Invalid per-file paper size." };
    out.paperSize = o.paperSize as PaperSize;
  }
  if (o.layout !== undefined) {
    if (o.layout !== "portrait" && o.layout !== "landscape") return { error: "Invalid per-file orientation." };
    out.layout = o.layout as PrintLayout;
  }
  if (o.copies !== undefined) {
    const n = Math.floor(Number(o.copies));
    if (!Number.isFinite(n) || n < 1 || n > 99) return { error: "Per-file copies must be between 1 and 99." };
    out.copies = n;
  }
  if (o.pagesPerSheet !== undefined) {
    const n = Math.floor(Number(o.pagesPerSheet));
    if (!Number.isFinite(n) || n < 1 || n > 4) return { error: "Invalid per-file pages-per-sheet." };
    out.pagesPerSheet = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Parses the optional fileSettingsJson form field: a JSON array, index-aligned
// with the uploaded files, each entry null or a partial override. Returns an
// all-null array (same length as fileCount) when the field is absent, so
// callers never need a separate "no overrides" branch.
function parseFileOverrides(form: FormData, fileCount: number): (FileSettingsOverride | null)[] | { error: string } {
  const raw = form.get("fileSettingsJson");
  if (raw === null) return new Array(fileCount).fill(null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return { error: "Invalid per-file settings list." };
  }
  if (!Array.isArray(parsed) || parsed.length !== fileCount) {
    return { error: "Per-file settings must match the number of files." };
  }
  const out: (FileSettingsOverride | null)[] = [];
  for (const entry of parsed) {
    const validated = validateFileOverride(entry);
    if (validated && "error" in validated) return validated;
    out.push(validated);
  }
  return out;
}

// Best-effort lookup of the logged-in customer's id from the session cookie.
// Unauthenticated requests (guests) resolve to `{ user: null }` with no error,
// so this is safe to call unconditionally; any failure (e.g. Supabase env not
// configured in pure-SQLite local dev) is swallowed and treated as a guest.
async function getCustomerUserId(): Promise<{ id: string; displayName: string | null } | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    // Only stamp jobs for actual customer accounts. A staff member (or any
    // non-customer session) uploading via the public form stays a guest job —
    // otherwise their jobs would surface under /my-jobs for that account.
    const { data: profile } = await supabase
      .from("customer_profiles")
      .select("id, display_name")
      .eq("id", user.id)
      .maybeSingle();
    return profile ? { id: user.id, displayName: profile.display_name ?? null } : null;
  } catch {
    return null;
  }
}

const printTypes: PrintType[] = ["bw", "color"];
const paperSizes: PaperSize[] = ["A3", "A4", "A5", "A6", "B5", "Letter", "Legal", "Photo"];
const layouts: PrintLayout[] = ["portrait", "landscape"];
const scaleOptions: PrintScale[] = ["default", "fit", "shrink", "noscale"];
const marginsOptions: PrintMargins[] = ["default", "none", "minimum"];
const duplexOptions: PrintDuplex[] = ["simplex", "long-edge", "short-edge"];

const JOBS_RATE_WINDOW_MS = 60 * 1000;
const JOBS_MAX_PER_WINDOW = 10; // 10 job creations per minute per IP

function parseDeliveryDetails(form: FormData, deliveryMethod: "pickup" | "delivery") {
  if (deliveryMethod === "pickup") {
    // For pickup jobs, capture the guest name/phone from the popup (if provided)
    // so admin can see who ordered even without a delivery address.
    const guestName = String(form.get("guestName") ?? "").trim().slice(0, 80) || null;
    const guestPhone = String(form.get("guestPhone") ?? "").replace(/\D/g, "").slice(0, 10) || null;
    return {
      customerName: guestName,
      customerPhone: guestPhone && guestPhone.length === 10 ? guestPhone : null,
      deliveryAddress: null,
      deliveryLatitude: null,
      deliveryLongitude: null,
      deliveryAccuracyMeters: null,
      deliveryLocationCapturedAt: null,
      deliveryPincode: null,
      deliveryArea: null,
    };
  }

  const customerName = String(form.get("customerName") ?? "").trim();
  const customerPhone = String(form.get("customerPhone") ?? "").trim();
  const deliveryAddress = String(form.get("deliveryAddress") ?? "").trim();
  if (!customerName) return { error: "Name is required for home delivery" } as const;
  if (!/^\d{10}$/.test(customerPhone)) return { error: "Enter a valid 10-digit phone number" } as const;
  if (!deliveryAddress) return { error: "Address is required for home delivery" } as const;

  const latitudeRaw = String(form.get("deliveryLatitude") ?? "").trim();
  const longitudeRaw = String(form.get("deliveryLongitude") ?? "").trim();
  const accuracyRaw = String(form.get("deliveryAccuracyMeters") ?? "").trim();
  let deliveryLatitude: number | null = null;
  let deliveryLongitude: number | null = null;
  let deliveryAccuracyMeters: number | null = null;

  if (latitudeRaw || longitudeRaw) {
    deliveryLatitude = Number(latitudeRaw);
    deliveryLongitude = Number(longitudeRaw);
    deliveryAccuracyMeters = accuracyRaw ? Number(accuracyRaw) : null;
    if (
      !Number.isFinite(deliveryLatitude) ||
      !Number.isFinite(deliveryLongitude) ||
      deliveryLatitude < -90 ||
      deliveryLatitude > 90 ||
      deliveryLongitude < -180 ||
      deliveryLongitude > 180 ||
      (deliveryAccuracyMeters !== null &&
        (!Number.isFinite(deliveryAccuracyMeters) || deliveryAccuracyMeters < 0 || deliveryAccuracyMeters > 100000))
    ) {
      return { error: "Invalid delivery location coordinates" } as const;
    }
  }

  const deliveryPincode = String(form.get("deliveryPincode") ?? "").trim();
  if (!isValidPincode(deliveryPincode)) return { error: "Enter a valid 6-digit pincode" } as const;
  const deliveryAreaRaw = String(form.get("deliveryArea") ?? "").trim();
  const deliveryArea = deliveryAreaRaw.length > 0 && deliveryAreaRaw.length <= 60 ? deliveryAreaRaw : null;

  return {
    customerName,
    customerPhone,
    deliveryAddress,
    deliveryLatitude,
    deliveryLongitude,
    deliveryAccuracyMeters,
    deliveryLocationCapturedAt: deliveryLatitude === null ? null : new Date().toISOString(),
    deliveryPincode,
    deliveryArea,
  };
}

export async function POST(request: NextRequest) {
  try {
    if (isRateLimited("jobs-create", clientIp(request.headers), JOBS_MAX_PER_WINDOW, JOBS_RATE_WINDOW_MS)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const hoursCheck = isAcceptingOrders(await getPricing());
    if (!hoursCheck.ok) {
      return NextResponse.json({ error: hoursCheck.reason }, { status: 503 });
    }

    const form = await request.formData();
    const customer = await getCustomerUserId();
    const customerUserId = customer?.id ?? null;

    if (form.get("bulk") === "true") {
      return await handleBulk(form, customer);
    }

    const printType = String(form.get("printType") ?? "bw") as PrintType;
    const copies = Math.max(1, Math.floor(Number(form.get("copies") ?? 1)));
    if (isNaN(copies) || copies < 1 || copies > 99) {
      return NextResponse.json({ error: "Copies must be between 1 and 99" }, { status: 400 });
    }
    const pageRangeRaw = form.get("pageRange");
    let pageRange: string | null = null;
    if (pageRangeRaw !== null && pageRangeRaw !== "") {
      pageRange = String(pageRangeRaw).trim().toLowerCase();
      const validSpecial = ["all", "even", "odd"];
      const isValidCustom = /^[\d,\-]+$/.test(pageRange);
      if (!validSpecial.includes(pageRange) && !isValidCustom) {
        return NextResponse.json({ error: "Invalid page range format" }, { status: 400 });
      }
      if (pageRange === "all") pageRange = null;
    }
    const paperSize = String(form.get("paperSize") ?? "A4") as PaperSize;
    const layout = String(form.get("layout") ?? "portrait") as PrintLayout;
    const pagesPerSheet = Math.max(1, Math.min(4, Math.floor(Number(form.get("pagesPerSheet") ?? 1)) || 1));
    const margins = String(form.get("margins") ?? "default") as PrintMargins;
    const scale = String(form.get("scale") ?? "default") as PrintScale;
    const duplex = String(form.get("duplex") ?? "simplex") as PrintDuplex;
    const hasSpiralBinding = form.get("hasSpiralBinding") === "true";
    const hasCoverFile = form.get("hasCoverFile") === "true";
    const hasBondPaper = form.get("hasBondPaper") === "true";
    const spiralBindingQty = Math.max(1, Math.min(99, Math.floor(Number(form.get("spiralBindingQty") ?? 1)) || 1));
    const coverFileQty = Math.max(1, Math.min(99, Math.floor(Number(form.get("coverFileQty") ?? 1)) || 1));
    if (
      !printTypes.includes(printType) ||
      !paperSizes.includes(paperSize) ||
      !layouts.includes(layout) ||
      !scaleOptions.includes(scale) ||
      !marginsOptions.includes(margins) ||
      !duplexOptions.includes(duplex)
    ) {
      return NextResponse.json({ error: "Invalid print settings" }, { status: 400 });
    }

    const customNote = String(form.get("customNote") ?? "").trim().slice(0, 250) || null;

    const deliveryMethod = String(form.get("deliveryMethod") ?? "pickup") as "pickup" | "delivery";
    if (deliveryMethod !== "pickup" && deliveryMethod !== "delivery") {
      return NextResponse.json({ error: "Invalid delivery method" }, { status: 400 });
    }
    const deliveryDetails = parseDeliveryDetails(form, deliveryMethod);
    if ("error" in deliveryDetails) {
      return NextResponse.json({ error: deliveryDetails.error }, { status: 400 });
    }

    const isDirectUpload = form.get("isDirectUpload") === "true";
    let storedName = "";
    let storagePath = "";
    let sizeBytes = 0;
    let pageCount = 0;
    let kind: any = "pdf";
    let needsConversion = 0;
    let originalName = "";
    let mimeType = "";

    if (isDirectUpload) {
      // Only the stored name + original name/mime are taken from the client.
      // The object path, real size, and page count are derived server-side so
      // none of them can be forged (e.g. to manipulate price).
      storedName = String(form.get("storedName") ?? "");
      originalName = String(form.get("originalName") ?? "");
      mimeType = String(form.get("mimeType") ?? "");

      if (!storedName || !originalName || !isValidStoredName(storedName)) {
        return NextResponse.json({ error: "Invalid upload metadata" }, { status: 400 });
      }
      // The sign endpoint issued an HMAC over the storedName it generated;
      // require it here so a client can only reference objects it uploaded.
      const uploadSig = String(form.get("uploadSig") ?? "");
      if (!uploadSig || !verifyStoredNameSig(storedName, uploadSig)) {
        return NextResponse.json({ error: "Invalid upload metadata" }, { status: 400 });
      }

      const { kind: k } = validateUpload(originalName, mimeType);
      kind = k;
      needsConversion = kind === "document" ? 1 : 0;
      storagePath = bucketPathFor(kind, storedName);

      // Size and page count are measured from the uploaded object itself, never
      // taken from the request. A client-supplied pageCount would let a
      // 300-page PDF be declared as 1 page and priced accordingly, while the
      // agent still prints every real page.
      if (kind === "document") {
        // Page count is unknown until LibreOffice conversion; size still is not.
        pageCount = 0;
        try {
          ({ sizeBytes } = await measureStoredFile(kind, storagePath));
        } catch {
          return NextResponse.json({ error: "Uploaded file could not be read" }, { status: 400 });
        }
      } else {
        try {
          ({ sizeBytes, pageCount } = await measureStoredFile(kind, storagePath));
        } catch {
          return NextResponse.json({ error: "Uploaded file could not be read" }, { status: 400 });
        }
      }
      if (!Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "File is too large" }, { status: 400 });
      }
    } else {
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "File is required" }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "File is too large" }, { status: 400 });
      }

      originalName = file.name;
      mimeType = file.type;

      const { ext, kind: k } = validateUpload(originalName, mimeType);
      kind = k;
      const saved = await saveUpload(file, ext, kind);
      storedName = saved.storedName;
      storagePath = saved.storagePath;
      sizeBytes = saved.sizeBytes;
      pageCount = await estimatePageCount(kind, saved.bytes);
      needsConversion = kind === "document" ? 1 : 0;
    }

    if (deliveryMethod === "delivery" && needsConversion) {
      return NextResponse.json(
        { error: "Home delivery is not available for DOC/DOCX files — please upload a PDF" },
        { status: 400 }
      );
    }

    // Pricing config, token allocation, and queue position are independent
    // lookups — run them concurrently instead of serially.
    const [pricing, token, queuePos] = await Promise.all([getPricing(), randomToken(), nextQueuePosition()]);
    if (deliveryMethod === "delivery") {
      const check = checkDeliveryServiceable(
        {
          pincode: deliveryDetails.deliveryPincode,
          area: deliveryDetails.deliveryArea,
          lat: deliveryDetails.deliveryLatitude,
          lng: deliveryDetails.deliveryLongitude,
        },
        pricing.serviceArea
      );
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
    }
    // Duplex requires the document itself to have 2+ pages — copies don't count
    // (each copy prints as its own separate stack, so a 1-page doc can't duplex).
    if (duplex !== "simplex" && selectedPageCount(pageCount, pageRange) < 2) {
      return NextResponse.json({ error: "Double-sided printing requires a document with at least 2 pages." }, { status: 400 });
    }
    const printPricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount: Math.max(pageCount, 1), pricing, duplex, pagesPerSheet });
    const addonFeePaise = (hasSpiralBinding ? calculateSpiralBindingPrice(selectedPageCount(pageCount, pageRange), pricing) * spiralBindingQty : 0) + (hasCoverFile ? pricing.coverFilePaise * coverFileQty : 0) + (hasBondPaper ? pricing.bondPaperPerPagePaise * selectedPageCount(pageCount, pageRange) : 0);
    const deliveryFeePaise = deliveryMethod === "delivery" ? effectiveDeliveryFeePaise(printPricePaise + addonFeePaise, pricing.deliveryFeePaise, pricing.freeDeliveryThresholdPaise) : 0;
    const pricePaise = printPricePaise + addonFeePaise + deliveryFeePaise;

    const jobData = {
      token,
      customer_user_id: customerUserId,
      print_type: printType,
      copies,
      page_range: pageRange,
      paper_size: paperSize,
      layout,
      pages_per_sheet: pagesPerSheet,
      margins,
      scale,
      duplex,
      has_spiral_binding: hasSpiralBinding,
      has_cover_file: hasCoverFile,
      has_bond_paper: hasBondPaper,
      spiral_binding_qty: spiralBindingQty,
      cover_file_qty: coverFileQty,
      page_count: pageCount,
      price_paise: pricePaise,
      needs_conversion: needsConversion,
      queue_position: queuePos,
      delivery_method: deliveryMethod,
      customer_name: deliveryDetails.customerName ?? customer?.displayName ?? null,
      customer_phone: deliveryDetails.customerPhone,
      delivery_address: deliveryDetails.deliveryAddress,
      delivery_pincode: deliveryDetails.deliveryPincode,
      delivery_area: deliveryDetails.deliveryArea,
      delivery_fee_paise: deliveryFeePaise,
      delivery_latitude: deliveryDetails.deliveryLatitude,
      delivery_longitude: deliveryDetails.deliveryLongitude,
      delivery_accuracy_meters: deliveryDetails.deliveryAccuracyMeters,
      delivery_location_captured_at: deliveryDetails.deliveryLocationCapturedAt,
      custom_note: customNote,
    };

    const fileData = {
      original_name: originalName,
      stored_name: storedName,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      file_kind: kind,
      storage_path: storagePath
    };

    const { jobId } = await createJob(jobData, fileData);

    return NextResponse.json({ jobId, token, pricePaise, deliveryFeePaise, addonFeePaise, needsConversion: Boolean(needsConversion), pageCount, queuePosition: queuePos });
  } catch (error) {
    // A Supabase/PostgREST rejection is a plain object, not an Error. Log the
    // real cause server-side only — raw messages leak table names, constraint
    // names and connection hints to anonymous callers.
    console.error("[/api/jobs] job creation failed:", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}

async function handleBulk(form: FormData, customer: { id: string; displayName: string | null } | null): Promise<NextResponse> {
  const customerUserId = customer?.id ?? null;
  // Shared settings (page range intentionally omitted for bulk).
  const printType = String(form.get("printType") ?? "bw") as PrintType;
  const copies = Math.max(1, Math.floor(Number(form.get("copies") ?? 1)));
  if (isNaN(copies) || copies < 1 || copies > 99) {
    return NextResponse.json({ error: "Copies must be between 1 and 99" }, { status: 400 });
  }
  const paperSize = String(form.get("paperSize") ?? "A4") as PaperSize;
  const layout = String(form.get("layout") ?? "portrait") as PrintLayout;
  const pagesPerSheet = Math.max(1, Math.min(4, Math.floor(Number(form.get("pagesPerSheet") ?? 1)) || 1));
  const margins = String(form.get("margins") ?? "default") as PrintMargins;
  const scale = String(form.get("scale") ?? "default") as PrintScale;
  const duplex = String(form.get("duplex") ?? "simplex") as PrintDuplex;
  const hasSpiralBinding = form.get("hasSpiralBinding") === "true";
  const hasCoverFile = form.get("hasCoverFile") === "true";
  const hasBondPaper = form.get("hasBondPaper") === "true";
  const spiralBindingQty = Math.max(1, Math.min(99, Math.floor(Number(form.get("spiralBindingQty") ?? 1)) || 1));
  const coverFileQty = Math.max(1, Math.min(99, Math.floor(Number(form.get("coverFileQty") ?? 1)) || 1));
  if (
    !printTypes.includes(printType) ||
    !paperSizes.includes(paperSize) ||
    !layouts.includes(layout) ||
    !scaleOptions.includes(scale) ||
    !marginsOptions.includes(margins) ||
    !duplexOptions.includes(duplex)
  ) {
    return NextResponse.json({ error: "Invalid print settings" }, { status: 400 });
  }

  const customNote = String(form.get("customNote") ?? "").trim().slice(0, 250) || null;

  const deliveryMethod = String(form.get("deliveryMethod") ?? "pickup") as "pickup" | "delivery";
  if (deliveryMethod !== "pickup" && deliveryMethod !== "delivery") {
    return NextResponse.json({ error: "Invalid delivery method" }, { status: 400 });
  }
  const deliveryDetails = parseDeliveryDetails(form, deliveryMethod);
  if ("error" in deliveryDetails) {
    return NextResponse.json({ error: deliveryDetails.error }, { status: 400 });
  }

  // Two upload sources: direct-to-storage (filesJson metadata) when the browser
  // could upload straight to Supabase, or a multipart fallback carrying the
  // actual file bytes (local/offline mode without NEXT_PUBLIC_* client env).
  let filesData: Array<{
    original_name: string;
    stored_name: string;
    mime_type: string;
    size_bytes: number;
    file_kind: string;
    storage_path: string;
  }>;
  let perFilePageCounts: number[];

  const filesJsonRaw = form.get("filesJson");
  if (filesJsonRaw !== null) {
    let rawFiles: unknown;
    try {
      rawFiles = JSON.parse(String(filesJsonRaw));
    } catch {
      return NextResponse.json({ error: "Invalid file list." }, { status: 400 });
    }
    const parsed = parseBulkFiles(rawFiles);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const files = parsed.files;
    // Same HMAC binding as the single-file direct-upload path: each storedName
    // must carry the signature issued by /api/uploads/sign.
    for (const f of files) {
      if (!f.uploadSig || !verifyStoredNameSig(f.storedName, f.uploadSig)) {
        return NextResponse.json({ error: "Invalid upload metadata." }, { status: 400 });
      }
    }
    // Measure every uploaded object server-side. The client-reported pageCount
    // in filesJson is advisory only (used for the browser's price preview) and
    // must not reach pricing — see measureStoredFile.
    let measured: Array<{ sizeBytes: number; pageCount: number }>;
    try {
      measured = await Promise.all(
        files.map((f) => measureStoredFile("pdf", bucketPathFor("pdf", f.storedName)))
      );
    } catch {
      return NextResponse.json({ error: "An uploaded file could not be read." }, { status: 400 });
    }

    const totalBytes = measured.reduce((sum, m) => sum + m.sizeBytes, 0);
    if (totalBytes > MAX_UPLOAD_BYTES * MAX_BULK_FILES) {
      return NextResponse.json({ error: "Total upload size is too large." }, { status: 400 });
    }

    perFilePageCounts = measured.map((m) => Math.max(1, m.pageCount));
    filesData = files.map((f, i) => ({
      original_name: f.originalName,
      stored_name: f.storedName,
      mime_type: f.mimeType || "application/pdf",
      size_bytes: measured[i].sizeBytes,
      file_kind: "pdf",
      storage_path: bucketPathFor("pdf", f.storedName),
    }));
  } else {
    // Multipart fallback: the browser sent the PDFs themselves. Save each via
    // the same path the single-file flow uses; page counts are derived from
    // the real bytes here, so this branch is server-authoritative.
    const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
    if (uploads.length === 0) {
      return NextResponse.json({ error: "Select at least one PDF." }, { status: 400 });
    }
    if (uploads.length > MAX_BULK_FILES) {
      return NextResponse.json({ error: `You can upload at most ${MAX_BULK_FILES} files at once.` }, { status: 400 });
    }

    filesData = [];
    perFilePageCounts = [];
    for (const upload of uploads) {
      if (upload.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: `"${upload.name}" is too large` }, { status: 400 });
      }
      let ext: string, kind: string;
      try {
        ({ ext, kind } = validateUpload(upload.name, upload.type));
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Invalid file type" },
          { status: 400 }
        );
      }
      if (kind !== "pdf") {
        return NextResponse.json({ error: "Bulk upload accepts PDF files only." }, { status: 400 });
      }
      const saved = await saveUpload(upload, ext, "pdf");
      perFilePageCounts.push(Math.max(1, await estimatePageCount("pdf", saved.bytes)));
      filesData.push({
        original_name: upload.name,
        stored_name: saved.storedName,
        mime_type: upload.type || "application/pdf",
        size_bytes: saved.sizeBytes,
        file_kind: "pdf",
        storage_path: saved.storagePath,
      });
    }
  }

  const overrides = parseFileOverrides(form, filesData.length);
  if ("error" in overrides) {
    return NextResponse.json({ error: overrides.error }, { status: 400 });
  }

  const pageCount = perFilePageCounts.reduce((sum, n) => sum + n, 0);
  const pricing = await getPricing();
  if (deliveryMethod === "delivery") {
    const check = checkDeliveryServiceable(
      {
        pincode: deliveryDetails.deliveryPincode,
        area: deliveryDetails.deliveryArea,
        lat: deliveryDetails.deliveryLatitude,
        lng: deliveryDetails.deliveryLongitude,
      },
      pricing.serviceArea
    );
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const jobDefaults = { printType, duplex, paperSize, layout, copies, pagesPerSheet };
  // Price per file at its own effective settings (override ?? job default)
  // and sum, instead of one flat calculatePrice() over the total page count —
  // that flat call was correct only because every file shared one setting.
  // A file downgrades its own duplex to simplex when it doesn't have enough
  // pages for it, rather than erroring the whole order out — the old
  // job-level "needs 2+ pages" guard doesn't make sense per-file since
  // duplex can now differ file to file. The downgrade is written back into
  // overrides[i] (not just used locally for pricing) so job_files.settings_json
  // — and therefore the print agent's effectiveJobForFile() — agrees with what
  // was actually charged; otherwise the agent would still attempt a duplex
  // print the customer was billed simplex for.
  let printPricePaise = 0;
  filesData.forEach((_, i) => {
    const effective = effectiveFileSettings(jobDefaults, overrides[i]);
    const pages = perFilePageCounts[i];
    if (effective.duplex !== "simplex" && pages < 2) {
      effective.duplex = "simplex";
      overrides[i] = { ...overrides[i], duplex: "simplex" };
    }
    printPricePaise += calculatePrice({
      printType: effective.printType,
      copies: effective.copies,
      pageRange: null,
      paperSize: effective.paperSize,
      pageCount: pages,
      pricing,
      duplex: effective.duplex,
      pagesPerSheet: effective.pagesPerSheet,
    });
  });
  const addonFeePaise = (hasSpiralBinding ? calculateSpiralBindingPrice(pageCount, pricing) * spiralBindingQty : 0) + (hasCoverFile ? pricing.coverFilePaise * coverFileQty : 0) + (hasBondPaper ? pricing.bondPaperPerPagePaise * pageCount : 0);
  const deliveryFeePaise = deliveryMethod === "delivery" ? effectiveDeliveryFeePaise(printPricePaise + addonFeePaise, pricing.deliveryFeePaise, pricing.freeDeliveryThresholdPaise) : 0;
  const pricePaise = printPricePaise + addonFeePaise + deliveryFeePaise;
  const [token, queuePos] = await Promise.all([randomToken(), nextQueuePosition()]);

  const jobData = {
    token,
    customer_user_id: customerUserId,
    print_type: printType,
    copies,
    page_range: null,
    paper_size: paperSize,
    layout,
    pages_per_sheet: pagesPerSheet,
    margins,
    scale,
    duplex,
    has_spiral_binding: hasSpiralBinding,
    has_cover_file: hasCoverFile,
    has_bond_paper: hasBondPaper,
    spiral_binding_qty: spiralBindingQty,
    cover_file_qty: coverFileQty,
    page_count: pageCount,
    price_paise: pricePaise,
    needs_conversion: 0,
    queue_position: queuePos,
    delivery_method: deliveryMethod,
    customer_name: deliveryDetails.customerName ?? customer?.displayName ?? null,
    customer_phone: deliveryDetails.customerPhone,
    delivery_address: deliveryDetails.deliveryAddress,
    delivery_pincode: deliveryDetails.deliveryPincode,
    delivery_area: deliveryDetails.deliveryArea,
    delivery_fee_paise: deliveryFeePaise,
    delivery_latitude: deliveryDetails.deliveryLatitude,
    delivery_longitude: deliveryDetails.deliveryLongitude,
    delivery_accuracy_meters: deliveryDetails.deliveryAccuracyMeters,
    delivery_location_captured_at: deliveryDetails.deliveryLocationCapturedAt,
    custom_note: customNote,
  };

  const filesDataWithSettings = filesData.map((fd, i) => ({ ...fd, settings: overrides[i] }));
  const { jobId } = await createJobWithFiles(jobData, filesDataWithSettings);

  return NextResponse.json({ jobId, token, pricePaise, deliveryFeePaise, addonFeePaise, needsConversion: false, pageCount, queuePosition: queuePos });
}

// Tokens are the counter-facing order code, so they stay 6 digits. Uniqueness
// was never enforced, and with a live queue the birthday bound makes collisions
// realistic — two active jobs sharing a token break every token lookup
// (getJobByToken resolves one row, or errors outright). Retry until we find a
// free one; the space is large enough that this almost always exits first try.
async function randomToken(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = crypto.randomInt(100000, 999999).toString();
    try {
      await getJobByToken(candidate);
      // Found an existing job with this token — collision, try again.
    } catch {
      return candidate;
    }
  }
  throw new Error("Could not allocate a free order token");
}


