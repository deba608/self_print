import { NextRequest, NextResponse } from "next/server";
import { getDb, mapJob, mapJobFile } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const job = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const file = getDb().prepare("SELECT * FROM job_files WHERE job_id = ?").get(id) as Record<string, unknown>;
  const events = getDb().prepare("SELECT * FROM print_events WHERE job_id = ? ORDER BY created_at DESC").all(id);
  return NextResponse.json({ job: mapJob(job), file: mapJobFile(file), events });
}
