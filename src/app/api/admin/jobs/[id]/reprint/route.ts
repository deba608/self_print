import { NextRequest, NextResponse } from "next/server";
import { getJobById, queueReprint, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  
  let job;
  try {
    job = await getJobById(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  
  if (job.needsConversion) return NextResponse.json({ error: "Job needs conversion before reprint" }, { status: 400 });
  if (job.status !== "printed") return NextResponse.json({ error: "Only printed jobs can be queued for reprint" }, { status: 400 });
  
  await queueReprint(id);
  
  // Broadcast to admin dashboard
  broadcast({ type: "job_update", jobId: id, status: "approved", token: job.token });
  
  const updated = await getJobById(id);
  return NextResponse.json({ ok: true, job: updated });
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
