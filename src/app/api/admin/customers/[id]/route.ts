import { NextRequest, NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing customer id" }, { status: 400 });

  try {
    const supabase = createAdminClient();

    if (id.startsWith("guest:")) {
      // Guest delivery customers have no auth user or customer_profiles row.
      // "Delete" = anonymize their jobs so PII is removed.
      const phone = id.slice("guest:".length);
      const { error } = await supabase
        .from("jobs")
        .update({ customer_name: null, customer_phone: null, delivery_address: null })
        .eq("customer_phone", phone)
        .is("customer_user_id", null);
      if (error) throw error;
    } else {
      // Registered customer — delete profile row then auth account.
      const { error: profileError } = await supabase
        .from("customer_profiles")
        .delete()
        .eq("id", id);
      if (profileError) throw profileError;

      const { error: authError } = await supabase.auth.admin.deleteUser(id);
      if (authError && !authError.message?.toLowerCase().includes("not found")) throw authError;
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[DELETE /api/admin/customers/[id]]", err);
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
