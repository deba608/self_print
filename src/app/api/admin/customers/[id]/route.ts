import { NextRequest, NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing customer id" }, { status: 400 });

  try {
    const supabase = await createClient();

    // Remove from customer_profiles first (FK cascade handles related data).
    const { error: profileError } = await supabase
      .from("customer_profiles")
      .delete()
      .eq("id", id);

    if (profileError) throw profileError;

    // Also delete the auth user so they can't log in. Uses service-role via
    // the server client — safe since this route is admin-only.
    const { error: authError } = await supabase.auth.admin.deleteUser(id);
    // Auth user may not exist for guest delivery customers — ignore that case.
    if (authError && !authError.message?.includes("not found")) throw authError;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[DELETE /api/admin/customers/[id]]", err);
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
