import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
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
  const job = getDb().prepare("SELECT status, needs_conversion FROM jobs WHERE id = ?").get(id) as
    | { status: JobStatus; needs_conversion: number }
    | undefined;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (status === "approved" && job.status !== "paid") {
    return NextResponse.json({ error: "Mark the job paid before release" }, { status: 400 });
  }
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
  return NextResponse.json({ ok: true });
}
