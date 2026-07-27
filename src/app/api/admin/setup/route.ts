import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET: Check if any staff profiles exist
export async function GET() {
  const adminClient = createAdminClient();
  const { count, error } = await adminClient
    .from("staff_profiles")
    .select("id", { count: "exact", head: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ hasStaff: (count ?? 0) > 0 });
}

// POST: Create the first super admin (only works when no staff exist)
export async function POST(request: NextRequest) {
  const adminClient = createAdminClient();

  // Check if any staff already exist
  const { count } = await adminClient
    .from("staff_profiles")
    .select("id", { count: "exact", head: true });

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: "Staff already exists. Use the invite form instead." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  // Create auth user
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

  // Create staff profile as super_admin
  const { error: profileError } = await adminClient
    .from("staff_profiles")
    .insert({
      id: authUser.user.id,
      email,
      display_name: displayName || email.split("@")[0],
      role: "super_admin",
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
    message: "Super admin created successfully. You can now log in.",
  });
}
