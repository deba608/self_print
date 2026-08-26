import { NextRequest, NextResponse } from "next/server";
import { getJobByToken } from "@/lib/db";
import { RAZORPAY_KEY_ID, isRazorpayConfigured, razorpay } from "@/lib/razorpay";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

// Creates a Razorpay order for a job's price. The amount is read from the job
// row on the server — never trusted from the client — so it can't be tampered.
export async function POST(request: NextRequest) {
  if (!isRazorpayConfigured()) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

  let token = "";
  try {
    ({ token } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Missing token." }, { status: 400 });
  }

  // Order creation is unauthenticated and mints real gateway orders — throttle
  // per IP+token so a script can't spam Razorpay order creation.
  const rateKey = `${clientIp(request.headers)}:${token}`;
  if (isRateLimited("payments-order", rateKey, 10, 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  let job;
  try {
    job = await getJobByToken(token);
  } catch {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (job.paidAt) {
    // Already paid — nothing to charge.
    return NextResponse.json({ error: "This job is already paid.", alreadyPaid: true }, { status: 409 });
  }
  if (job.status === "cancelled") {
    return NextResponse.json({ error: "This job was cancelled." }, { status: 409 });
  }

  const amount = Math.round(job.pricePaise);
  if (amount < 100) {
    return NextResponse.json({ error: "Amount is below the ₹1 minimum for online payment." }, { status: 400 });
  }

  try {
    const order = await razorpay().orders.create({
      amount,
      currency: "INR",
      receipt: job.token,
      notes: { jobId: job.id, token: job.token },
    });
    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RAZORPAY_KEY_ID,
    });
  } catch (err: any) {
    const status = err?.statusCode === 401 ? 401 : 500;
    const message = status === 401 ? "Payment gateway auth failed." : "Could not start payment.";
    return NextResponse.json({ error: message }, { status });
  }
}
