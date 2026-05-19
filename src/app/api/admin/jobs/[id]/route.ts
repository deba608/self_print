import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getDb, getPricing, mapJob, mapJobFile } from "@/lib/db";
import { calculatePrice } from "@/lib/pricing";
import { requireAdminResponse } from "@/lib/security";
import type { JobStatus, PaperSize, PrintLayout, PrintScale, PrintType } from "@/lib/types";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const job = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const file = getDb().prepare("SELECT * FROM job_files WHERE job_id = ?").get(id) as Record<string, unknown>;
  const events = getDb().prepare("SELECT * FROM print_events WHERE job_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json({ job: mapJob(job), file: mapJobFile(file), events });
}

const printTypes: PrintType[] = ["bw", "color"];
const paperSizes: PaperSize[] = ["A3", "A4", "A5", "A6", "B5", "Letter", "Legal", "Photo"];
const layouts: PrintLayout[] = ["portrait", "landscape"];
const scaleOptions: PrintScale[] = ["default", "fit", "shrink", "noscale"];

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json();
  const existing = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const status = existing.status as JobStatus;
  if (status === "approved" || status === "printing") {
    return NextResponse.json({ error: "Print settings cannot be changed while a job is released or printing." }, { status: 400 });
  }

  const printType = String(body.printType ?? existing.print_type) as PrintType;
  const copies = Math.min(99, Math.max(1, Math.floor(Number(body.copies ?? existing.copies))));
  const pageRange = String(body.pageRange ?? "").trim() || null;
  const paperSize = String(body.paperSize ?? existing.paper_size) as PaperSize;
  const layout = String(body.layout ?? existing.layout ?? "portrait") as PrintLayout;
  const pagesPerSheet = 1;
  const margins = "default";
  const scale = String(body.scale ?? existing.scale ?? "default") as PrintScale;

  if (
    !printTypes.includes(printType) ||
    !Number.isInteger(copies) ||
    !paperSizes.includes(paperSize) ||
    !layouts.includes(layout) ||
    !scaleOptions.includes(scale)
  ) {
    return NextResponse.json({ error: "Invalid print settings" }, { status: 400 });
  }

  const pageCount = Math.max(Number(existing.page_count), 1);
  const pricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount, pricing: getPricing() });
  const now = new Date().toISOString();

  getDb().transaction(() => {
    getDb().prepare(`
      UPDATE jobs
      SET print_type = ?, copies = ?, page_range = ?, paper_size = ?, layout = ?,
          pages_per_sheet = ?, margins = ?, scale = ?, price_paise = ?, updated_at = ?
      WHERE id = ?
    `).run(printType, copies, pageRange, paperSize, layout, pagesPerSheet, margins, scale, pricePaise, now, id);
    getDb().prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'settings', ?, ?)")
      .run(
        crypto.randomUUID(),
        id,
        `Admin updated print settings: ${describeSettings({ printType, copies, pageRange, paperSize, layout, scale })}.`,
        now
      );
  })();

  const updated = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown>;
  return NextResponse.json({ job: mapJob(updated) });
}

import fs from "node:fs/promises";
import path from "node:path";
import { ORIGINALS_DIR, CONVERTED_DIR } from "@/lib/config";

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;

  const job = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const file = getDb().prepare("SELECT * FROM job_files WHERE job_id = ?").get(id) as Record<string, unknown> | undefined;

  try {
    if (file) {
      const originalPath = path.join(ORIGINALS_DIR, file.stored_name as string);
      await fs.unlink(originalPath).catch(() => {});
      if (file.converted_name) {
        await fs.unlink(path.join(CONVERTED_DIR, file.converted_name as string)).catch(() => {});
      }
    }
  } catch {
    // Ignore file deletion errors - continue with database deletion
  }

  getDb().prepare("DELETE FROM print_events WHERE job_id = ?").run(id);
  getDb().prepare("DELETE FROM job_files WHERE job_id = ?").run(id);
  getDb().prepare("DELETE FROM jobs WHERE id = ?").run(id);

  return NextResponse.json({ success: true });
}

function describeSettings(input: {
  printType: PrintType;
  copies: number;
  pageRange: string | null;
  paperSize: PaperSize;
  layout: PrintLayout;
  scale: PrintScale;
}) {
  return [
    input.pageRange || "All pages",
    input.layout,
    input.printType === "bw" ? "black & white" : "color",
    input.paperSize,
    `${input.scale} scale`,
    `${input.copies} copy(s)`
  ].join(", ");
}
