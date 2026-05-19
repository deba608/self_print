import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getJobById, getJobFile, updateJobSettings, deleteJob, getPricing, sseClients } from "@/lib/db";
import { calculatePrice } from "@/lib/pricing";
import { requireAdminResponse } from "@/lib/security";
import type { JobStatus, PaperSize, PrintLayout, PrintScale, PrintType } from "@/lib/types";
import { deleteFile } from "@/lib/storage";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  
  try {
    const job = await getJobById(id);
    const file = await getJobFile(id);
    return NextResponse.json({ job, file, events: [] });
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
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
  
  let existing;
  try {
    existing = await getJobById(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const status = existing.status as JobStatus;
  if (status === "approved" || status === "printing") {
    return NextResponse.json({ error: "Print settings cannot be changed while a job is released or printing." }, { status: 400 });
  }

  const printType = String(body.printType ?? existing.printType) as PrintType;
  const copies = Math.min(99, Math.max(1, Math.floor(Number(body.copies ?? existing.copies))));
  const pageRange = String(body.pageRange ?? "").trim() || null;
  const paperSize = String(body.paperSize ?? existing.paperSize) as PaperSize;
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

  const pageCount = Math.max(existing.pageCount, 1);
  const pricing = await getPricing();
  const pricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount, pricing });
  const now = new Date().toISOString();

  await updateJobSettings(id, {
    printType,
    copies,
    pageRange,
    paperSize,
    layout,
    pagesPerSheet,
    margins,
    scale,
    pricePaise,
    updatedAt: now
  });

  const updated = await getJobById(id);
  return NextResponse.json({ job: updated });
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;

  let job;
  try {
    job = await getJobById(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    const file = await getJobFile(id);
    if (file?.storagePath) {
      await deleteFile(file.storagePath);
    }
  } catch {
    // Ignore file deletion errors
  }

  await deleteJob(id);

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
