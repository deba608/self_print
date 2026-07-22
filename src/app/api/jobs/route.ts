import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { MAX_BULK_FILES, parseBulkFiles, sumPages } from "@/lib/bulk";
import { createJob, createJobWithFiles, getPricing, nextQueuePosition, sseClients } from "@/lib/db";
import { estimatePageCount, saveUpload, validateUpload } from "@/lib/files";
import { bucketPathFor, isValidStoredName, verifyStoredNameSig } from "@/lib/storage";
import { clientIp, isRateLimited } from "@/lib/ratelimit";
import { calculatePrice, selectedPageCount } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/server";
import type { PaperSize, PrintDuplex, PrintLayout, PrintMargins, PrintScale, PrintType } from "@/lib/types";

// Best-effort lookup of the logged-in customer's id from the session cookie.
// Unauthenticated requests (guests) resolve to `{ user: null }` with no error,
// so this is safe to call unconditionally; any failure (e.g. Supabase env not
// configured in pure-SQLite local dev) is swallowed and treated as a guest.
async function getCustomerUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
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

export async function POST(request: NextRequest) {
  try {
    if (isRateLimited("jobs-create", clientIp(request.headers), JOBS_MAX_PER_WINDOW, JOBS_RATE_WINDOW_MS)) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const form = await request.formData();
    const customerUserId = await getCustomerUserId();

    if (form.get("bulk") === "true") {
      return await handleBulk(form, customerUserId);
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

    const deliveryMethod = String(form.get("deliveryMethod") ?? "pickup") as "pickup" | "delivery";
    if (deliveryMethod !== "pickup" && deliveryMethod !== "delivery") {
      return NextResponse.json({ error: "Invalid delivery method" }, { status: 400 });
    }
    let customerName: string | null = null;
    let customerPhone: string | null = null;
    let deliveryAddress: string | null = null;
    if (deliveryMethod === "delivery") {
      customerName = String(form.get("customerName") ?? "").trim();
      customerPhone = String(form.get("customerPhone") ?? "").trim();
      deliveryAddress = String(form.get("deliveryAddress") ?? "").trim();
      if (!customerName) {
        return NextResponse.json({ error: "Name is required for home delivery" }, { status: 400 });
      }
      if (!/^\d{10}$/.test(customerPhone)) {
        return NextResponse.json({ error: "Enter a valid 10-digit phone number" }, { status: 400 });
      }
      if (!deliveryAddress) {
        return NextResponse.json({ error: "Address is required for home delivery" }, { status: 400 });
      }
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

      // Use client-reported values — sizeBytes was already validated by /api/uploads/sign,
      // and pageCount was computed by the browser using the same regex as estimatePageCount.
      // This avoids downloading the entire file just to measure two numbers (saves 3–8 s).
      sizeBytes = Math.max(1, Number(form.get("sizeBytes") ?? 0));
      if (!Number.isFinite(sizeBytes) || sizeBytes > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "File is too large" }, { status: 400 });
      }
      if (kind === "image") {
        pageCount = 1;
      } else if (kind === "document") {
        pageCount = 0;
      } else {
        pageCount = Math.max(1, Math.min(1000, Math.floor(Number(form.get("pageCount") ?? 1))));
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
      pageCount = estimatePageCount(kind, saved.bytes);
      needsConversion = kind === "document" ? 1 : 0;
    }

    const pricing = await getPricing();
    // Duplex requires the document itself to have 2+ pages — copies don't count
    // (each copy prints as its own separate stack, so a 1-page doc can't duplex).
    if (duplex !== "simplex" && selectedPageCount(pageCount, pageRange) < 2) {
      return NextResponse.json({ error: "Double-sided printing requires a document with at least 2 pages." }, { status: 400 });
    }
    const printPricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount: Math.max(pageCount, 1), pricing, duplex });
    const deliveryFeePaise = deliveryMethod === "delivery" ? pricing.deliveryFeePaise : 0;
    const pricePaise = printPricePaise + deliveryFeePaise;
    const token = randomToken();
    const queuePos = await nextQueuePosition();

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
      page_count: pageCount,
      price_paise: pricePaise,
      needs_conversion: needsConversion,
      queue_position: queuePos,
      delivery_method: deliveryMethod,
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_address: deliveryAddress,
      delivery_fee_paise: deliveryFeePaise
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

    broadcast({ type: "new_job", jobId, token, queuePosition: queuePos });

    return NextResponse.json({ jobId, token, pricePaise, deliveryFeePaise, needsConversion: Boolean(needsConversion), pageCount, queuePosition: queuePos });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}

async function handleBulk(form: FormData, customerUserId: string | null): Promise<NextResponse> {
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
  let pageCount: number;

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
    pageCount = sumPages(files);
    filesData = files.map((f) => ({
      original_name: f.originalName,
      stored_name: f.storedName,
      mime_type: f.mimeType || "application/pdf",
      size_bytes: f.sizeBytes,
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
    pageCount = 0;
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
      pageCount += Math.max(1, estimatePageCount("pdf", saved.bytes));
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
  const pricing = await getPricing();
  // Bulk has no page range; duplex needs 2+ pages across the whole batch.
  if (duplex !== "simplex" && pageCount < 2) {
    return NextResponse.json({ error: "Double-sided printing requires at least 2 pages." }, { status: 400 });
  }
  const pricePaise = calculatePrice({ printType, copies, pageRange: null, paperSize, pageCount: Math.max(pageCount, 1), pricing, duplex });
  const token = randomToken();
  const queuePos = await nextQueuePosition();

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
    page_count: pageCount,
    price_paise: pricePaise,
    needs_conversion: 0,
    queue_position: queuePos,
  };

  const { jobId } = await createJobWithFiles(jobData, filesData);
  broadcast({ type: "new_job", jobId, token, queuePosition: queuePos });

  return NextResponse.json({ jobId, token, pricePaise, needsConversion: false, pageCount, queuePosition: queuePos });
}

function randomToken() {
  return crypto.randomInt(100000, 999999).toString();
}

function broadcast(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(client);
    }
  }
}
