import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { getJobById, getJobFile, getPricing, markJobConverted } from "@/lib/db";
import { readFileBytes, saveBuffer, deleteFile } from "@/lib/storage";
import { convertDocToPdf, isLibreOfficeAvailable } from "@/lib/convert";
import { estimatePageCount } from "@/lib/files";
import { calculatePrice } from "@/lib/pricing";
import { requireAdminResponse } from "@/lib/security";

// Converts a single job's DOC/DOCX upload to PDF on demand from the admin UI.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;

  if (!(await isLibreOfficeAvailable())) {
    return NextResponse.json(
      { error: "LibreOffice not installed on the server. Set LIBREOFFICE_PATH or run `npm run convert`." },
      { status: 503 }
    );
  }

  let job;
  let file;
  try {
    job = await getJobById(id);
    file = await getJobFile(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.needsConversion !== 1) {
    return NextResponse.json({ error: "Job does not need conversion" }, { status: 400 });
  }

  try {
    const ext = path.extname(file.originalName).toLowerCase() || ".docx";
    const oldPath = file.storagePath;
    const inputBytes = await readFileBytes(oldPath);
    const pdf = await convertDocToPdf(inputBytes, ext);
    const saved = await saveBuffer(pdf, ".pdf", "document", "application/pdf");
    const pageCount = estimatePageCount("pdf", pdf);
    const pricing = await getPricing();
    const pricePaise =
      calculatePrice({
        printType: job.printType,
        copies: job.copies,
        pageRange: job.pageRange,
        paperSize: job.paperSize,
        pageCount,
        pricing
      }) + (job.deliveryMethod === "delivery" ? job.deliveryFeePaise : 0);

    await markJobConverted(id, file.id, {
      storedName: saved.storedName,
      storagePath: saved.storagePath,
      sizeBytes: saved.sizeBytes,
      pageCount,
      pricePaise
    });
    await deleteFile(oldPath);

    const updated = await getJobById(id);
    return NextResponse.json({ job: updated, pageCount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Conversion failed" },
      { status: 500 }
    );
  }
}
