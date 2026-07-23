import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can revoke staff" }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing staff id" }, { status: 400 });
  }
  if (id === admin.id) {
    return NextResponse.json({ error: "You cannot revoke your own access" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { count: superAdminCount } = await adminClient
    .from("staff_profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin");
  const { data: target } = await adminClient
    .from("staff_profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();
  if (target?.role === "super_admin" && (superAdminCount ?? 0) <= 1) {
    return NextResponse.json({ error: "Cannot remove the last super admin" }, { status: 400 });
  }

  // staff_profiles.invited_by references auth.users(id) without ON DELETE SET
  // NULL, so deleting an inviter would be rejected by Postgres while rows still
  // point at them. Detach those references first.
  const { error: detachError } = await adminClient
    .from("staff_profiles")
    .update({ invited_by: null })
    .eq("invited_by", id);
  if (detachError) {
    return NextResponse.json({ error: detachError.message }, { status: 500 });
  }
  const { error } = await adminClient.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // staff_profiles row is removed via ON DELETE CASCADE on auth.users(id).
  return NextResponse.json({ ok: true });
}
