import crypto from "node:crypto";
import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getDb, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const db = getDb();

  const job = db.prepare("SELECT id, token FROM jobs WHERE id = ?").get(id) as
    | { id: string; token: string }
    | undefined;

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const files = db.prepare("SELECT storage_path FROM job_files WHERE job_id = ?").all(id) as
    | Array<{ storage_path: string }>
    | [];

  db.transaction(() => {
    db.prepare("DELETE FROM print_events WHERE job_id = ?").run(id);
    db.prepare("DELETE FROM job_files WHERE job_id = ?").run(id);
    db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
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

  broadcast({ type: "job_deleted", jobId: id, token: job.token });

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
