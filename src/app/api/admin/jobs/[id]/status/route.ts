import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getJobById, updateJobStatus, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";
import type { JobStatus } from "@/lib/types";

const allowed: JobStatus[] = ["paid", "approved", "printed", "cancelled"];

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
  
  const invalid = invalidTransition(job.status, status);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  if (status === "approved" && job.needsConversion) {
    return NextResponse.json({ error: "DOC/DOCX jobs need conversion before release" }, { status: 400 });
  }
  
  await updateJobStatus(id, status);
  
  broadcast({ type: "job_update", jobId: id, status, token: job.token });
  
  const updated = await getJobById(id);
  return NextResponse.json({ ok: true, job: updated });
}

function invalidTransition(current: JobStatus, next: JobStatus) {
  if (next === "cancelled") {
    return ["printed", "cancelled"].includes(current) ? "This job can no longer be cancelled." : "";
  }
  if (next === "paid" && current !== "pending_payment") {
    return "Only unpaid jobs can be marked paid.";
  }
  if (next === "approved" && current !== "paid") {
    return "Mark the job paid before release.";
  }
  if (next === "printed" && !["approved", "printing", "failed"].includes(current)) {
    return "Only released, printing, or failed jobs can be marked done.";
  }
  return "";
}

function broadcast(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(client);
    }
  }
}
