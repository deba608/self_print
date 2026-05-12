import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const job = getDb().prepare("SELECT needs_conversion FROM jobs WHERE id = ?").get(id) as { needs_conversion: number } | undefined;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.needs_conversion) return NextResponse.json({ error: "Job needs conversion before reprint" }, { status: 400 });
  const now = new Date().toISOString();
  getDb().prepare("UPDATE jobs SET status = 'approved', updated_at = ? WHERE id = ?").run(now, id);
  getDb().prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, 'reprint', 'Admin queued reprint.', ?)")
    .run(crypto.randomUUID(), id, now);
  return NextResponse.json({ ok: true });
}
