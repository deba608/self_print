import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getJobById, updateJobStatus, markJobPaid } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";
import type { JobStatus } from "@/lib/types";

const allowed: (JobStatus | "paid")[] = ["paid", "approved", "printed", "cancelled"];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { status } = await request.json();
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: "Unsupported status action" }, { status: 400 });
  }
  const { id } = await params;

  let job;
  try {
    job = await getJobById(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // "paid" is not a status transition — payment is tracked independently of
  // print progress (jobs can be released/printed before they're paid), so it
  // only ever touches paid_at.
  if (status === "paid") {
    if (job.status === "cancelled") {
      return NextResponse.json({ error: "Cancelled jobs can't be marked paid." }, { status: 400 });
    }
    await markJobPaid(id);
  } else {
    const invalid = invalidTransition(job.status, status);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    if (status === "approved" && job.needsConversion) {
      return NextResponse.json({ error: "DOC/DOCX jobs need conversion before release" }, { status: 400 });
    }
    // Pickup orders may print before payment (pay-at-counter flow), but a
    // delivery order has no counter step — online payment is its only
    // settlement, so it must be paid before it's released for printing.
    if (status === "approved" && job.deliveryMethod === "delivery" && !job.paidAt) {
      return NextResponse.json({ error: "Delivery orders must be paid online before release." }, { status: 400 });
    }
    await updateJobStatus(id, status);
  }

  const updated = await getJobById(id);

  return NextResponse.json({ ok: true, job: updated });
}

function invalidTransition(current: JobStatus, next: JobStatus) {
  if (next === "cancelled") {
    return ["printed", "cancelled"].includes(current) ? "This job can no longer be cancelled." : "";
  }
  // "paid" is a legacy status value from before payment was decoupled from
  // print progress — treat it the same as pending_payment (not yet released).
  if (next === "approved" && current !== "pending_payment" && current !== "paid") {
    return "Only queued jobs can be released.";
  }
  if (next === "printed" && !["approved", "printing", "failed"].includes(current)) {
    return "Only released, printing, or failed jobs can be marked done.";
  }
  return "";
}
