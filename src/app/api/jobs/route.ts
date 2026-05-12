import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { getDb, getPricing } from "@/lib/db";
import { estimatePageCount, saveUpload, validateUpload } from "@/lib/files";
import { calculatePrice } from "@/lib/pricing";
import type { PaperSize, PrintType } from "@/lib/types";

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
    if (!["bw", "color"].includes(printType) || !["A4", "Legal", "Photo"].includes(paperSize)) {
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

    getDb().transaction(() => {
      getDb().prepare(`
        INSERT INTO jobs (id, token, status, print_type, copies, page_range, paper_size, page_count, price_paise, needs_conversion, created_at, updated_at)
        VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(jobId, token, printType, copies, pageRange, paperSize, pageCount, pricePaise, needsConversion, now, now);
      getDb().prepare(`
        INSERT INTO job_files (id, job_id, original_name, stored_name, mime_type, size_bytes, file_kind, storage_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(fileId, jobId, file.name, saved.storedName, file.type, saved.sizeBytes, kind, saved.storagePath, now);
      getDb().prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'created', ?, ?)")
        .run(crypto.randomUUID(), jobId, needsConversion ? "Document upload needs conversion before printing." : "Customer submitted job.", now);
    })();

    return NextResponse.json({ jobId, token, pricePaise, needsConversion: Boolean(needsConversion), pageCount });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload failed" }, { status: 400 });
  }
}

function randomToken() {
  return crypto.randomInt(100000, 999999).toString();
}
