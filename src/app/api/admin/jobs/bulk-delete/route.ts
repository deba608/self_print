import crypto from "node:crypto";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getDb, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function POST(request: NextRequest) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const body = await request.json();
  const { ids } = body as { ids?: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "No job IDs provided" }, { status: 400 });
  }

  const db = getDb();

  const jobs = db.prepare(
    `SELECT id, token FROM jobs WHERE id IN (${ids.map(() => "?").join(",")})`
  ).all(...ids) as Array<{ id: string; token: string }>;

  const jobIds = jobs.map((j) => j.id);

  const files = db.prepare(
    `SELECT storage_path FROM job_files WHERE job_id IN (${jobIds.map(() => "?").join(",")})`
  ).all(...jobIds) as Array<{ storage_path: string }>;

  db.transaction(() => {
    const deleteStmt = db.prepare("DELETE FROM print_events WHERE job_id = ?");
    const deleteFilesStmt = db.prepare("DELETE FROM job_files WHERE job_id = ?");
    const deleteJobsStmt = db.prepare("DELETE FROM jobs WHERE id = ?");

    for (const jobId of jobIds) {
      deleteStmt.run(jobId);
      deleteFilesStmt.run(jobId);
      deleteJobsStmt.run(jobId);
    }
  })();

  for (const file of files) {
    try {
      if (fs.existsSync(file.storage_path)) {
        fs.unlinkSync(file.storage_path);
      }
    } catch {
      // Ignore file deletion errors
    }
  }

  for (const job of jobs) {
    broadcast({ type: "job_deleted", jobId: job.id, token: job.token });
  }

  return NextResponse.json({ ok: true, deleted: jobIds.length });
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
