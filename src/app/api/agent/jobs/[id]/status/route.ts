import { NextRequest, NextResponse } from "next/server";
import { updateJobStatusByAgent, sseClients } from "@/lib/db";
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
  
  await updateJobStatusByAgent(id, status, message);
  
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
