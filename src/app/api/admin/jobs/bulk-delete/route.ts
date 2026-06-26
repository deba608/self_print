import { NextRequest, NextResponse } from "next/server";
import { bulkDeleteJobs, getJobFilesForJobs, sseClients } from "@/lib/db";
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

  // Fetch files for only the requested IDs, not the entire jobs table.
  const fileMap = await getJobFilesForJobs(ids);
  await Promise.allSettled(
    Object.values(fileMap).map(f => f.storagePath ? deleteFile(f.storagePath) : Promise.resolve())
  );

  await bulkDeleteJobs(ids);

  for (const id of ids) {
    broadcast({ type: "job_deleted", jobId: id });
  }

  return NextResponse.json({ ok: true, deleted: ids.length });
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
