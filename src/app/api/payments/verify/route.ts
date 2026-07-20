import { NextRequest, NextResponse } from "next/server";
import { broadcastSse, getJobByToken, markJobPaid } from "@/lib/db";
import { verifyPaymentSignature } from "@/lib/razorpay";

// Client-side confirmation: the browser posts the Checkout success payload right
// after payment. We verify the signature, then mark the job paid. The webhook
// is the backup path for when the browser closes before this runs.
export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, token } = body ?? {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !token) {
    return NextResponse.json({ error: "Missing payment fields." }, { status: 400 });
  }

  if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
  }

  let job;
  try {
    job = await getJobByToken(token);
  } catch {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  // Idempotent: if the webhook already marked it paid, treat as success.
  if (!job.paidAt) {
    const { paidAt } = await markJobPaid(job.id);
    broadcastSse({ type: "job_update", jobId: job.id, status: job.status, paidAt, token: job.token });
  }

  return NextResponse.json({ ok: true, status: "paid" });
}
