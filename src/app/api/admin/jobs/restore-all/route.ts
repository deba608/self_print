import { NextResponse } from "next/server";
import { restoreAllArchivedJobs } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

// Un-archives every job hidden by a prior delete/bulk-delete so it reappears
// in the admin queue and history. Their uploaded files were already removed
// at archive time and cannot be recovered — this restores the order record.
export async function POST() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const restored = await restoreAllArchivedJobs();
  return NextResponse.json({ ok: true, restored });
}
