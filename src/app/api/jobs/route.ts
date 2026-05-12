import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { getDb, getPricing, nextQueuePosition, sseClients } from "@/lib/db";
import { estimatePageCount, saveUpload, validateUpload } from "@/lib/files";
import { calculatePrice } from "@/lib/pricing";
import type { PaperSize, PrintLayout, PrintMargins, PrintScale, PrintType } from "@/lib/types";

const printTypes: PrintType[] = ["bw", "color"];
const paperSizes: PaperSize[] = ["A4", "Letter", "Legal", "Photo"];
const layouts: PrintLayout[] = ["portrait", "landscape"];
const pagesPerSheetOptions = [1, 2, 4, 6, 9, 16];
const marginsOptions: PrintMargins[] = ["default", "none", "minimum"];
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
    const copies = Math.max(1, Number(form.get("copies") ?? 1));
    const pageRange = String(form.get("pageRange") ?? "").trim() || null;
    const paperSize = String(form.get("paperSize") ?? "A4") as PaperSize;
    const layout = String(form.get("layout") ?? "portrait") as PrintLayout;
    const pagesPerSheet = Number(form.get("pagesPerSheet") ?? 1);
    const margins = String(form.get("margins") ?? "default") as PrintMargins;
    const scale = String(form.get("scale") ?? "default") as PrintScale;
    if (
      !printTypes.includes(printType) ||
      !paperSizes.includes(paperSize) ||
      !layouts.includes(layout) ||
      !pagesPerSheetOptions.includes(pagesPerSheet) ||
      !marginsOptions.includes(margins) ||
      !scaleOptions.includes(scale)
    ) {
      return NextResponse.json({ error: "Invalid print settings" }, { status: 400 });
    }

    const { ext, kind } = validateUpload(file);
    const saved = await saveUpload(file, ext);
    const pageCount = estimatePageCount(kind, saved.bytes);
    const needsConversion = kind === "document" ? 1 : 0;
    const pricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount: Math.max(pageCount, 1), pricing: getPricing() });
    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const token = randomToken();
    const queuePos = nextQueuePosition();

    getDb().transaction(() => {
      getDb().prepare(`
        INSERT INTO jobs (id, token, status, print_type, copies, page_range, paper_size, layout, pages_per_sheet, margins, scale, page_count, price_paise, needs_conversion, queue_position, created_at, updated_at)
        VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(jobId, token, printType, copies, pageRange, paperSize, layout, pagesPerSheet, margins, scale, pageCount, pricePaise, needsConversion, queuePos, now, now);
      getDb().prepare(`
        INSERT INTO job_files (id, job_id, original_name, stored_name, mime_type, size_bytes, file_kind, storage_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, jobId, file.name, saved.storedName, file.type, saved.sizeBytes, kind, saved.storagePath, now);
      getDb().prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'created', ?, ?)")
        .run(crypto.randomUUID(), jobId, needsConversion ? "Document upload needs conversion before printing." : "Customer submitted job.", now);
    })();

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
