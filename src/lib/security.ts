import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { StaffProfile } from "./types";

// Any authenticated staff row (super_admin, admin, delivery).
export async function requireStaff(): Promise<StaffProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, email, display_name, role, invited_by, created_at")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    invitedBy: profile.invited_by,
    createdAt: profile.created_at,
  };
}

// Admin-tier only: delivery riders must never pass this gate.
  export async function requireAdmin(): Promise<StaffProfile | null> {
    const ADMIN_ROLES = new Set(["super_admin", "admin"]);
    const staff = await requireStaff();
    // Allow-list on purpose: a role added to staff_profiles later must never
    // silently pass the admin gate (deny-lists fail open by default).
    if (!staff || !ADMIN_ROLES.has(staff.role)) return null;
    return staff;
  }

export async function requireAdminResponse(): Promise<NextResponse | null> {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  return null;
}

export async function requireStaffResponse(): Promise<NextResponse | null> {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  return null;
}
