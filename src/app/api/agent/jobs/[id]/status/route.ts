import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb, sseClients } from "@/lib/db";
import { verifyAgentToken } from "@/lib/security";
import type { JobStatus } from "@/lib/types";

const allowed: JobStatus[] = ["printing", "printed", "failed"];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyAgentToken(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }
  const { status, message } = await request.json();
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: "Unsupported agent status" }, { status: 400 });
  }
  const { id } = await params;
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE jobs
    SET status = ?, updated_at = ?, printed_at = CASE WHEN ? = 'printed' THEN ? ELSE printed_at END
    WHERE id = ?
  `).run(status, now, status, now, id);
  getDb().prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), id, status, String(message ?? ""), now);
  
  // Broadcast to admin dashboard
  broadcast({ type: "job_update", jobId: id, status });
  
  return NextResponse.json({ ok: true });
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
