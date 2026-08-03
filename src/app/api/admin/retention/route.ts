import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { getRetentionConfig, updateRetentionConfig, getLatestCleanupEvent } from "@/lib/db";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can view data retention settings" }, { status: 403 });
  }

  const config = await getRetentionConfig();
  const lastRun = await getLatestCleanupEvent();
  return NextResponse.json({ config, lastRun });
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can change data retention settings" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const cartAbandonMinutes = body?.cartAbandonMinutes;
  const fileRetentionDays = body?.fileRetentionDays;
  const strayFileRetentionHours = body?.strayFileRetentionHours;
  const loginEventRetentionDays = body?.loginEventRetentionDays;
  const fields = { cartAbandonMinutes, fileRetentionDays, strayFileRetentionHours, loginEventRetentionDays };

  for (const [key, value] of Object.entries(fields)) {
    if (!Number.isInteger(value) || value <= 0) {
      return NextResponse.json({ error: `${key} must be a positive integer` }, { status: 400 });
    }
  }

  await updateRetentionConfig(fields as {
    cartAbandonMinutes: number;
    fileRetentionDays: number;
    strayFileRetentionHours: number;
    loginEventRetentionDays: number;
  });

  return NextResponse.json({ ok: true });
}
