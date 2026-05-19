import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb, mapJob, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";
import type { JobStatus } from "@/lib/types";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const job = getDb().prepare("SELECT status, needs_conversion, token FROM jobs WHERE id = ?").get(id) as
    | { status: JobStatus; needs_conversion: number; token: string }
    | undefined;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.needs_conversion) return NextResponse.json({ error: "Job needs conversion before reprint" }, { status: 400 });
  if (job.status !== "printed") return NextResponse.json({ error: "Only printed jobs can be queued for reprint" }, { status: 400 });
  const now = new Date().toISOString();
  getDb().prepare("UPDATE jobs SET status = 'approved', updated_at = ? WHERE id = ?").run(now, id);
  getDb().prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'reprint', 'Admin queued reprint.', ?)")
    .run(crypto.randomUUID(), id, now);
  
  // Broadcast to admin dashboard
  broadcast({ type: "job_update", jobId: id, status: "approved", token: job.token });
  
  const updated = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown>;
  return NextResponse.json({ ok: true, job: mapJob(updated) });
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
