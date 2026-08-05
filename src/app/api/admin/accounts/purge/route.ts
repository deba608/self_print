import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { bulkDeleteJobs, getFinishedJobIdsBefore, getJobFilesForJobs } from "@/lib/db";
import { deleteFile } from "@/lib/storage";

// Manual "clear old records" for Accounts/Data Management. Cleanup no longer
// deletes finished jobs automatically (their history feeds Accounts
// analytics), so this is the escape valve for reclaiming space — explicit,
// super-admin only, and restricted to jobs that are already done
// (printed/cancelled/failed/expired). Active/unpaid-in-progress jobs are
// never eligible, so a wide date range can't remove a live order.
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can clear accounting records" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const beforeDate = body?.beforeDate;
  if (typeof beforeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate)) {
    return NextResponse.json({ error: "beforeDate must be a YYYY-MM-DD string" }, { status: 400 });
  }
  const beforeIso = new Date(`${beforeDate}T00:00:00.000Z`).toISOString();

  const ids = await getFinishedJobIdsBefore(beforeIso);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  const fileMap = await getJobFilesForJobs(ids);
  await Promise.allSettled(
    Object.values(fileMap).map((f) => (f.storagePath ? deleteFile(f.storagePath) : Promise.resolve()))
  );

  await bulkDeleteJobs(ids);

  return NextResponse.json({ ok: true, deleted: ids.length });
}
