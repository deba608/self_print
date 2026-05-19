import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { createJob, getPricing, nextQueuePosition, sseClients } from "@/lib/db";
import { estimatePageCount, saveUpload, validateUpload } from "@/lib/files";
import { calculatePrice } from "@/lib/pricing";
import type { PaperSize, PrintLayout, PrintScale, PrintType } from "@/lib/types";

const printTypes: PrintType[] = ["bw", "color"];
const paperSizes: PaperSize[] = ["A3", "A4", "A5", "A6", "B5", "Letter", "Legal", "Photo"];
const layouts: PrintLayout[] = ["portrait", "landscape"];
const scaleOptions: PrintScale[] = ["default", "fit", "shrink", "noscale"];

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File is too large" }, { status: 400 });
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
    const pagesPerSheet = 1;
    const margins = "default";
    const scale = String(form.get("scale") ?? "default") as PrintScale;
    if (
      !printTypes.includes(printType) ||
      !paperSizes.includes(paperSize) ||
      !layouts.includes(layout) ||
      !scaleOptions.includes(scale)
    ) {
      return NextResponse.json({ error: "Invalid print settings" }, { status: 400 });
    }

    const { ext, kind } = validateUpload(file);
    const saved = await saveUpload(file, ext, kind);
    const pageCount = estimatePageCount(kind, saved.bytes);
    const needsConversion = kind === "document" ? 1 : 0;
    const pricing = await getPricing();
    const pricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount: Math.max(pageCount, 1), pricing });
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
      page_count: pageCount,
      price_paise: pricePaise,
      needs_conversion: needsConversion,
      queue_position: queuePos
    };

    const fileData = {
      original_name: file.name,
      stored_name: saved.storedName,
      mime_type: file.type,
      size_bytes: saved.sizeBytes,
      file_kind: kind,
      storage_path: saved.storagePath
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
