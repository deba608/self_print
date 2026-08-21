import { NextRequest, NextResponse } from "next/server";
import { getJobByToken, updateJobStatus } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

// Customer self-cancel. Only the job's own owner may cancel, and only before
// it's already printing/printed/cancelled. No refund is issued here — there
// is no online refund flow (Razorpay refund API is never called anywhere in
// this codebase); a paid job that gets cancelled needs a manual counter
// refund by staff, so the response flags that case for the UI to explain.
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

  return NextResponse.json({ ok: true, wasPaid: Boolean(job.paidAt) });
}
