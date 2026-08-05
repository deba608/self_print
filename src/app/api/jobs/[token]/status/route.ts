import { NextRequest, NextResponse } from "next/server";
import { getJobByToken, getJobsAhead } from "@/lib/db";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

// Public payment-status poll for the customer's token screen. Exposes only
// the job's status and paid time — nothing else — so the phone can flip to
// the receipt the moment staff marks a cash/QR payment as paid.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  // Generous enough for legitimate polling (every few seconds from one
  // device) while still capping how fast the 6-digit token space (900k
  // combos) can be brute-forced from a single source.
  if (isRateLimited("job-status", clientIp(request.headers), 60, 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  try {
    const job = await getJobByToken(token);
    const jobsAhead = ["printed", "cancelled", "failed", "expired"].includes(job.status)
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
        issueReportedAt: job.issueReportedAt,
        issueResolvedAt: job.issueResolvedAt,
        deliveryMethod: job.deliveryMethod,
        deliveryStatus: job.deliveryStatus,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
