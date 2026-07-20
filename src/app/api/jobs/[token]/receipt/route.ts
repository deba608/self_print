import { NextRequest, NextResponse } from "next/server";
import { getJobByToken, getJobFilesByJob, getPricing } from "@/lib/db";

// Public receipt data for the customer's status/track page. Only exposed once
// the job is actually paid — mirrors what BillReceipt renders right after
// checkout, rebuilt from stored job data so it also works after a page reload
// or on a different device (a plain re-lookup of the token).
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  let job;
  try {
    job = await getJobByToken(token);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!job.paidAt) {
    return NextResponse.json({ error: "This order hasn't been paid yet." }, { status: 409 });
  }

  const files = await getJobFilesByJob(job.id);
  const pricing = await getPricing();
  const perPagePaise = job.duplex !== "simplex" && job.printType === "bw" && pricing.duplexBwPerPagePaise
    ? pricing.duplexBwPerPagePaise
    : job.printType === "bw" ? pricing.bwPerPagePaise : pricing.colorPerPagePaise;

  // Per-file page counts aren't persisted (only the job total is) — for a
  // multi-file batch, show one aggregate line rather than a guessed split.
  const billFiles = files.length > 1
    ? [{ name: `${files.length} files`, pages: job.pageCount }]
    : [{ name: files[0]?.originalName ?? "Document", pages: job.pageCount }];

  return NextResponse.json(
    {
      shopName: (process.env.SHOP_NAME ?? "Print Shop").trim(),
      token: job.token,
      queuePosition: job.queuePosition,
      files: billFiles,
      settings: {
        printType: job.printType,
        duplex: job.duplex,
        paperSize: job.paperSize,
        copies: job.copies,
        pagesPerSheet: job.pagesPerSheet,
      },
      totalPaise: job.pricePaise,
      perPagePaise,
      totalPages: job.pageCount,
      paidVia: job.paidVia ?? "counter",
      paidAt: job.paidAt,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
