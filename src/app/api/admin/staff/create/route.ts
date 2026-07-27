import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const VALID_ROLES = ["super_admin", "admin"];

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can create staff accounts" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const role = body?.role;

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Role must be 'super_admin' or 'admin'" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Check if email is already registered
  const { data: existing } = await adminClient.auth.admin.listUsers();
  if (existing?.users?.some((u) => u.email === email)) {
    return NextResponse.json({ error: "A user with this email already exists" }, { status: 400 });
  }

  // Create auth user (email confirmed immediately)
  const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser?.user) {
    return NextResponse.json(
      { error: authError?.message ?? "Failed to create user" },
      { status: 400 }
    );
  }

  // Create staff profile
  const supabase = await createClient();
  const { error: profileError } = await supabase
    .from("staff_profiles")
    .insert({
      id: authUser.user.id,
      email,
      display_name: displayName || email.split("@")[0],
      role,
      invited_by: admin.id,
    });

  if (profileError) {
    // Clean up auth user if profile creation fails
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json(
      { error: profileError.message ?? "Failed to create staff profile" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    staff: {
      id: authUser.user.id,
      email,
      displayName: displayName || email.split("@")[0],
      role,
      createdAt: new Date().toISOString(),
    },
  });
}
