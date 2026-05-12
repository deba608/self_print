import { NextRequest, NextResponse } from "next/server";
import { getDb, mapJob, mapJobFile } from "@/lib/db";
import { verifyAgentToken } from "@/lib/security";

export async function GET(request: NextRequest) {
  if (!verifyAgentToken(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }
  const row = getDb().prepare(`
    SELECT * FROM jobs
    WHERE status = 'approved' AND needs_conversion = 0
    ORDER BY updated_at ASC
    LIMIT 1
  `).get() as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ job: null });
  const file = getDb().prepare("SELECT * FROM job_files WHERE job_id = ?").get(row.id) as Record<string, unknown>;
  return NextResponse.json({ job: mapJob(row), file: mapJobFile(file) });
}
