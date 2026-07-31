import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireAdminResponse } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthRedirectUrl } from "@/lib/site-url";
import type { StaffRole } from "@/lib/types";

const VALID_ROLES: StaffRole[] = ["super_admin", "admin", "delivery"];

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  // Any authenticated staff member (any role) can list staff — the
  // "staff can read all staff profiles" RLS policy (is_staff()) allows this
  // via the cookie-bound client, so no service-role client is needed here.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("id, email, display_name, role, invited_by, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Unable to load staff" }, { status: 500 });
  }

  const staff = (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ staff });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "Only super admins can invite staff" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const role = body?.role;

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Role must be 'super_admin' or 'admin'" }, { status: 400 });
  }

  // Inviting a user requires the service-role key (auth.admin.* is
  // privileged and unavailable to the cookie-bound client).
  const adminClient = createAdminClient();
  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: getAuthRedirectUrl("/staff/accept-invite"),
  });

  if (inviteError || !invited?.user) {
    return NextResponse.json({ error: inviteError?.message ?? "Unable to invite user" }, { status: 400 });
  }

  // The staff_profiles insert is done with the cookie-bound (non-privileged)
  // server client, not the service-role admin client: the current request
  // is authenticated as `admin`, a super_admin, via the session cookie, so
  // auth.uid() resolves correctly inside the RLS check and the
  // "super admins can insert staff profiles" policy (is_super_admin())
  // passes on its own merits. Using the service-role client here would
  // bypass RLS instead of exercising it, hiding a real policy bug should
  // one ever creep in.
  const supabase = await createClient();
  const { data: profile, error: insertError } = await supabase
    .from("staff_profiles")
    .insert({
      id: invited.user.id,
      email,
      role,
      invited_by: admin.id,
    })
    .select("id, email, display_name, role, invited_by, created_at")
    .single();

  if (insertError || !profile) {
    // Do not leave an unusable Auth user behind when profile creation fails;
    // otherwise a retry reports that the email is already registered.
    await adminClient.auth.admin.deleteUser(invited.user.id);
    return NextResponse.json({ error: insertError?.message ?? "Invited, but failed to create staff profile" }, { status: 500 });
  }

  return NextResponse.json({
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    invitedBy: profile.invited_by,
    createdAt: profile.created_at,
  });
}
