import { NextResponse } from "next/server";
import { getAgentToken } from "./db";
import { createClient } from "@/lib/supabase/server";
import type { StaffProfile } from "./types";

export async function requireAdmin(): Promise<StaffProfile | null> {
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

export async function requireAdminResponse(): Promise<NextResponse | null> {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  return null;
}

export async function verifyAgentToken(authHeader: string | null) {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const row = await getAgentToken(token);
  return Boolean(row);
}
