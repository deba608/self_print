import { NextRequest, NextResponse } from "next/server";
import { getJobByToken, updateJobStatus, markJobRefunded } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { isRazorpayConfigured, refundPayment } from "@/lib/razorpay";

// Customer self-cancel. Only the job's own owner may cancel, and only before
// it's already printing/printed/cancelled. If the job was paid online via
// Razorpay, a full refund is issued automatically through Razorpay's refund
// API. Counter-paid jobs still need a manual refund at the counter — there's
// no way to reverse cash from here.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let job;
  try {
    job = await getJobByToken(token);
  } catch {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (job.customerUserId !== user.id) {
    return NextResponse.json({ error: "This job does not belong to you." }, { status: 403 });
  }

  if (["printed", "printing", "cancelled"].includes(job.status)) {
    return NextResponse.json({ error: "This job can no longer be cancelled." }, { status: 400 });
  }

  await updateJobStatus(job.id, "cancelled");

  const needsOnlineRefund =
    Boolean(job.paidAt) && job.paidVia === "online" && Boolean(job.razorpayPaymentId);

  if (!needsOnlineRefund) {
    return NextResponse.json({ ok: true, wasPaid: Boolean(job.paidAt), refundStatus: null });
  }

  if (!isRazorpayConfigured()) {
    await markJobRefunded(job.id, "failed");
    return NextResponse.json({ ok: true, wasPaid: true, refundStatus: "failed" });
  }

  try {
    await refundPayment(job.razorpayPaymentId as string, job.pricePaise);
    await markJobRefunded(job.id, "refunded");
    return NextResponse.json({ ok: true, wasPaid: true, refundStatus: "refunded" });
  } catch {
    // Razorpay rejected or errored on the refund call. The job stays
    // cancelled either way; flag it for staff to refund manually.
    await markJobRefunded(job.id, "failed");
    return NextResponse.json({ ok: true, wasPaid: true, refundStatus: "failed" });
  }
}
