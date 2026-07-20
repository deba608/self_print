import { NextRequest, NextResponse } from "next/server";
import { getJobByToken, getJobsAhead } from "@/lib/db";

// Public payment-status poll for the customer's token screen. Exposes only
// the job's status and paid time — nothing else — so the phone can flip to
// the receipt the moment staff marks a cash/QR payment as paid.
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  try {
    const job = await getJobByToken(token);
    const jobsAhead = ["printed", "cancelled", "failed"].includes(job.status)
      ? 0
      : await getJobsAhead(job);
    // Public tracking data only — the token is the sole credential, so no
    // file names or contents are ever exposed here.
    return NextResponse.json(
      {
        status: job.status,
        paidAt: job.paidAt,
        queuePosition: job.queuePosition,
        jobsAhead,
        pricePaise: job.pricePaise,
        createdAt: job.createdAt,
        fileCount: job.fileCount ?? 1,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
