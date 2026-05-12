import { NextResponse } from "next/server";
import { getDb, getPricing, mapJob, mapJobFile } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const pricing = getPricing();
  const rows = getDb().prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").all() as Record<string, unknown>[];
  const jobs = rows.map((row) => {
    const file = getDb().prepare("SELECT * FROM job_files WHERE job_id = ?").get(row.id) as Record<string, unknown>;
    const createdMs = new Date(String(row.created_at)).getTime();
    const expiresAt = new Date(createdMs + pricing.expiryMinutes * 60 * 1000).toISOString();
    return { ...mapJob(row), file: mapJobFile(file), expiresAt };
  });
  return NextResponse.json({ jobs, expiryMinutes: pricing.expiryMinutes });
}