import { NextRequest, NextResponse } from "next/server";
import { broadcastSse, getJobById, updateJobStatus } from "@/lib/db";
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
        if (job.status === "pending_payment") {
          await updateJobStatus(job.id, "paid");
          broadcastSse({ type: "job_update", jobId: job.id, status: "paid", token: job.token });
        }
      } catch {
        // Unknown / already-removed job — ack anyway so Razorpay stops retrying.
      }
    }
  }

  // Always 200 for handled events so Razorpay doesn't retry indefinitely.
  return NextResponse.json({ ok: true });
}
