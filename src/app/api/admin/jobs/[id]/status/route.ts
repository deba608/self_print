import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb, mapJob, sseClients } from "@/lib/db";
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
  const job = getDb().prepare("SELECT status, needs_conversion, token FROM jobs WHERE id = ?").get(id) as
    | { status: JobStatus; needs_conversion: number; token: string }
    | undefined;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const invalid = invalidTransition(job.status, status);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  if (status === "approved" && job.needs_conversion) {
    return NextResponse.json({ error: "DOC/DOCX jobs need conversion before release" }, { status: 400 });
  }
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE jobs
    SET status = ?, updated_at = ?, paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END,
        printed_at = CASE WHEN ? = 'printed' THEN ? ELSE printed_at END
    WHERE id = ?
  `).run(status, now, status, now, status, now, id);
  getDb().prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), id, status, `Admin set status to ${status}.`, now);

  broadcast({ type: "job_update", jobId: id, status, token: job.token });

  const updated = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown>;
  return NextResponse.json({ ok: true, job: mapJob(updated) });
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
  if (next === "printed" && current !== "approved" && current !== "printing") {
    return "Only released or printing jobs can be marked done.";
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
