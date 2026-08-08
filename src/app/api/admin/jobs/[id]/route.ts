import { NextRequest, NextResponse } from "next/server";
import { getJobById, getJobEvents, getJobFilesByJob, updateJobSettings, deleteJob, getPricing } from "@/lib/db";
import { calculatePrice, calculateSpiralBindingPrice, selectedPageCount } from "@/lib/pricing";
import { requireAdminResponse } from "@/lib/security";
import type { JobStatus, PaperSize, PrintDuplex, PrintLayout, PrintMargins, PrintScale, PrintType } from "@/lib/types";
import { deleteFile } from "@/lib/storage";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  
  try {
    const job = await getJobById(id);
    const files = await getJobFilesByJob(id);
    const file = files[0] ?? null;
    const events = await getJobEvents(id);
    return NextResponse.json({ job, file, files, events });
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
}

const printTypes: PrintType[] = ["bw", "color"];
const paperSizes: PaperSize[] = ["A3", "A4", "A5", "A6", "B5", "Letter", "Legal", "Photo"];
const layouts: PrintLayout[] = ["portrait", "landscape"];
const scaleOptions: PrintScale[] = ["default", "fit", "shrink", "noscale"];
const marginOptions: PrintMargins[] = ["default", "none", "minimum"];
const pagesPerSheetOptions = [1, 2, 4, 6, 9, 16];
const duplexOptions: PrintDuplex[] = ["simplex", "long-edge", "short-edge"];

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
  const pagesPerSheet = Math.floor(Number(body.pagesPerSheet ?? existing.pagesPerSheet ?? 1));
  const margins = String(body.margins ?? existing.margins ?? "default") as PrintMargins;
  const scale = String(body.scale ?? existing.scale ?? "default") as PrintScale;
  const duplex = String(body.duplex ?? existing.duplex ?? "simplex") as PrintDuplex;
  const hasSpiralBinding = body.hasSpiralBinding === true || body.has_spiral_binding === true;
  const hasCoverFile = body.hasCoverFile === true || body.has_cover_file === true;
  const spiralBindingQty = Math.max(1, Math.min(99, Math.floor(Number(body.spiralBindingQty ?? existing.spiralBindingQty ?? 1)) || 1));
  const coverFileQty = Math.max(1, Math.min(99, Math.floor(Number(body.coverFileQty ?? existing.coverFileQty ?? 1)) || 1));

  if (
    !printTypes.includes(printType) ||
    !Number.isInteger(copies) ||
    !paperSizes.includes(paperSize) ||
    !layouts.includes(layout) ||
    !scaleOptions.includes(scale) ||
    !marginOptions.includes(margins) ||
    !pagesPerSheetOptions.includes(pagesPerSheet) ||
    !duplexOptions.includes(duplex)
  ) {
    return NextResponse.json({ error: "Invalid print settings" }, { status: 400 });
  }

  const pageCount = Math.max(existing.pageCount, 1);
  // Duplex requires the document itself to have 2+ pages — copies don't count
  // (each copy prints as its own separate stack, so a 1-page doc can't duplex).
  if (duplex !== "simplex" && selectedPageCount(pageCount, pageRange) < 2) {
    return NextResponse.json({ error: "Double-sided printing requires a document with at least 2 pages." }, { status: 400 });
  }
  const pricing = await getPricing();
  const printPricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount, pricing, duplex, pagesPerSheet });
   const addonFeePaise = (hasSpiralBinding ? calculateSpiralBindingPrice(selectedPageCount(pageCount, pageRange), pricing) * spiralBindingQty : 0) + (hasCoverFile ? pricing.coverFilePaise * coverFileQty : 0);
  const pricePaise =
    printPricePaise + addonFeePaise +
    (existing.deliveryMethod === "delivery" ? existing.deliveryFeePaise : 0);
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
    duplex,
    pricePaise,
    hasSpiralBinding,
    hasCoverFile,
    spiralBindingQty,
    coverFileQty,
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
    const files = await getJobFilesByJob(id);
    for (const f of files) {
      if (f.storagePath) await deleteFile(f.storagePath).catch(() => undefined);
    }
  } catch {
    // Ignore file deletion errors
  }

  await deleteJob(id);

  return NextResponse.json({ success: true });
}
