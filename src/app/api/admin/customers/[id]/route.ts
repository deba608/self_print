import { NextRequest, NextResponse } from "next/server";
import { requireAdminResponse } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeRepeatedly(value: string): string {
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const { id: rawId } = await params;
  if (!rawId) return NextResponse.json({ error: "Missing customer id" }, { status: 400 });

  // The id may still be percent-encoded here (guest ids contain ":" and "+").
  // Decode until stable so "guest%3A%2B91..." and "guest:+91..." behave alike.
  const id = decodeRepeatedly(rawId);

  try {
    const supabase = createAdminClient();

    if (id.startsWith("guest:")) {
      // Guest delivery customers have no auth user or customer_profiles row.
      // "Delete" = anonymize their jobs so PII is removed.
      const phone = id.slice("guest:".length);
      if (!phone) return NextResponse.json({ error: "Guest id has no phone" }, { status: 400 });

      const { error } = await supabase
        .from("jobs")
        .update({ customer_name: null, customer_phone: null, delivery_address: null })
        .eq("customer_phone", phone)
        .is("customer_user_id", null);
      if (error) throw error;
    } else if (UUID_RE.test(id)) {
      // Registered customer — delete profile row then auth account.
      const { error: profileError } = await supabase
        .from("customer_profiles")
        .delete()
        .eq("id", id);
      if (profileError) throw profileError;

      const { error: authError } = await supabase.auth.admin.deleteUser(id);
      if (authError && !authError.message?.toLowerCase().includes("not found")) throw authError;
    } else {
      // Never hand a non-UUID to the Admin API — it fails in confusing ways.
      return NextResponse.json({ error: `Unrecognised customer id: ${id}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[DELETE /api/admin/customers/[id]]", err);
    return NextResponse.json({ error: `v2: ${describeError(err)}` }, { status: 500 });
  }
}

// Supabase/Postgrest errors carry `message` as a non-enumerable property, so a
// plain JSON.stringify() collapses them to "{}". Walk own property names to
// build something that always identifies the failure.
function describeError(err: unknown): string {
  if (typeof err === "string") return err;
  if (!err || typeof err !== "object") return String(err);

  const e = err as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["message", "details", "hint", "code", "status", "name"]) {
    const value = e[key];
    if (value !== undefined && value !== null && value !== "") {
      parts.push(`${key}=${String(value)}`);
    }
  }
  if (parts.length > 0) return parts.join(" | ");

  const own = Object.getOwnPropertyNames(err)
    .map((key) => `${key}=${String(e[key])}`)
    .join(" | ");
  return own || Object.prototype.toString.call(err);
}
