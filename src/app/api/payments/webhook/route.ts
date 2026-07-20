import { NextRequest, NextResponse } from "next/server";
import { broadcastSse, getJobById, markJobPaid } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/razorpay";

// Backup confirmation: Razorpay calls this on payment.captured. Marks the job
// paid even if the customer closed the browser before the client verify ran.
// The jobId travels in the order's `notes` set at order-creation time.
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (event?.event === "payment.captured") {
    const jobId = event?.payload?.payment?.entity?.notes?.jobId;
    if (jobId) {
      try {
        const job = await getJobById(jobId);
        if (!job.paidAt) {
          const { paidAt } = await markJobPaid(job.id, "online");
          broadcastSse({ type: "job_update", jobId: job.id, status: job.status, paidAt, token: job.token });
        }
      } catch {
        // Unknown / already-removed job — ack anyway so Razorpay stops retrying.
      }
    }
  }

  // Always 200 for handled events so Razorpay doesn't retry indefinitely.
  return NextResponse.json({ ok: true });
}
