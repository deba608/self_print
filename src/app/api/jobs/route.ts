import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { createJob, getPricing, nextQueuePosition, sseClients } from "@/lib/db";
import { estimatePageCount, saveUpload, validateUpload } from "@/lib/files";
import { bucketPathFor } from "@/lib/storage";
import { calculatePrice, selectedPageCount } from "@/lib/pricing";
import type { PaperSize, PrintDuplex, PrintLayout, PrintMargins, PrintScale, PrintType } from "@/lib/types";

const printTypes: PrintType[] = ["bw", "color"];
const paperSizes: PaperSize[] = ["A3", "A4", "A5", "A6", "B5", "Letter", "Legal", "Photo"];
const layouts: PrintLayout[] = ["portrait", "landscape"];
const scaleOptions: PrintScale[] = ["default", "fit", "shrink", "noscale"];
const marginsOptions: PrintMargins[] = ["default", "none", "minimum"];
const duplexOptions: PrintDuplex[] = ["simplex", "long-edge", "short-edge"];

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();

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

      if (!storedName || !originalName) {
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
    const pricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount: Math.max(pageCount, 1), pricing, duplex });
    const token = randomToken();
    const queuePos = await nextQueuePosition();

    const jobData = {
      token,
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
      queue_position: queuePos
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

    return NextResponse.json({ jobId, token, pricePaise, needsConversion: Boolean(needsConversion), pageCount, queuePosition: queuePos });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
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
