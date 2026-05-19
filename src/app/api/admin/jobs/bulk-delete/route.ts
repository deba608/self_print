import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getJobs, deleteJob, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";
import { deleteFile } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const body = await request.json();
  const { ids } = body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No job IDs provided" }, { status: 400 });
  }

  const allJobs = await getJobs();
  const jobsToDelete = allJobs.filter(j => ids.includes(j.id));

  for (const job of jobsToDelete) {
    try {
      const file = await import("@/lib/db").then(m => m.getJobFile(job.id)).catch(() => null);
      if (file?.storagePath) {
        await deleteFile(file.storagePath);
      }
    } catch {
      // Ignore file deletion errors
    }
    
    await deleteJob(job.id);
    broadcast({ type: "job_deleted", jobId: job.id, token: job.token });
  }

  return NextResponse.json({ ok: true, deleted: jobsToDelete.length });
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
