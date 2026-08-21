import { NextRequest, NextResponse } from "next/server";
import { getJobByToken, markJobPaid } from "@/lib/db";
import { isRazorpayConfigured, razorpay, verifyPaymentSignature } from "@/lib/razorpay";

// Client-side confirmation: the browser posts the Checkout success payload right
// after payment. We verify the signature, then mark the job paid. The webhook
// is the backup path for when the browser closes before this runs.
//
// The signature alone only proves "some order of ours was paid" — it says
// nothing about WHICH job. Without the binding checks below, a customer could
// pay for a ₹1 job and replay that same {order_id, payment_id, signature}
// triple against any other job's token to mark it paid for free.
export async function POST(request: NextRequest) {
  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

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

  // Already paid — nothing to do. Checked before the gateway round-trip so a
  // duplicate confirmation from the browser stays cheap and idempotent.
  if (job.paidAt) {
    return NextResponse.json({ ok: true, status: "paid" });
  }

  // Bind the payment to this specific job, straight from the gateway:
  //   1. the order must be the one we created for THIS job (notes.jobId), and
  //   2. the payment must belong to that order, be captured/authorized, and
  //      cover the job's full price.
  try {
    const order: any = await razorpay().orders.fetch(razorpay_order_id);
    if (String(order?.notes?.jobId ?? "") !== job.id) {
      return NextResponse.json({ error: "Payment does not belong to this job." }, { status: 400 });
    }

    const payment: any = await razorpay().payments.fetch(razorpay_payment_id);
    if (String(payment?.order_id ?? "") !== razorpay_order_id) {
      return NextResponse.json({ error: "Payment does not belong to this order." }, { status: 400 });
    }
    if (payment?.status !== "captured" && payment?.status !== "authorized") {
      return NextResponse.json({ error: "Payment is not complete." }, { status: 400 });
    }
    if (Number(payment?.amount ?? 0) < Math.round(job.pricePaise)) {
      return NextResponse.json({ error: "Paid amount is less than the job price." }, { status: 400 });
    }
  } catch (err: any) {
    // A lookup failure means we cannot prove the payment belongs to this job,
    // so refuse. The webhook remains the backup path for genuine payments.
    const status = err?.statusCode === 400 || err?.statusCode === 404 ? 400 : 502;
    return NextResponse.json(
      { error: status === 400 ? "Unknown payment reference." : "Could not confirm payment. Please try again." },
      { status }
    );
  }

  const { paidAt } = await markJobPaid(job.id, "online", razorpay_payment_id);

  return NextResponse.json({ ok: true, status: "paid" });
}
