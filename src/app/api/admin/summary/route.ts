import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const today = new Date().toISOString().slice(0, 10);
  const row = getDb().prepare(`
    SELECT COUNT(*) as jobs, COALESCE(SUM(price_paise), 0) as total
    FROM jobs
    WHERE date(created_at) = date(?) AND status IN ('paid', 'approved', 'printing', 'printed')
  `).get(today) as { jobs: number; total: number };
  return NextResponse.json({ jobs: row.jobs, totalPaise: row.total });
}
