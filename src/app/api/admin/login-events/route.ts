import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LoginEvent } from "@/lib/types";

function mapRow(row: any): LoginEvent {
  return {
    id: row.id,
    staffId: row.staff_id ?? null,
    email: row.email,
    ip: row.ip ?? null,
    browser: row.browser ?? null,
    os: row.os ?? null,
    device: row.device ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    success: row.success,
    failureReason: row.failure_reason ?? null,
    loggedAt: row.logged_at,
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");

  const client = createAdminClient();

  if (staffId) {
    const { data, error } = await client
      .from("admin_login_events")
      .select("*")
      .eq("staff_id", staffId)
      .order("logged_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
    }
    return NextResponse.json((data ?? []).map(mapRow));
  }

  // All staff — last 200 events across all
  const { data, error } = await client
    .from("admin_login_events")
    .select("*")
    .order("logged_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
  return NextResponse.json((data ?? []).map(mapRow));
}
