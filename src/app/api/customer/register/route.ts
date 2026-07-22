import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? "Unable to create account" }, { status: 400 });
  }

  // signUp() does not establish a session until the account's email is
  // confirmed (locked project decision: email confirmation is required), so
  // the cookie-bound client has no auth.uid() to satisfy the "customers can
  // insert own profile" RLS check at this point. Use the service-role
  // client to insert the profile row, scoping it explicitly to the id
  // returned by the trusted signUp() response above.
  const adminClient = createAdminClient();
  const { error: insertError } = await adminClient.from("customer_profiles").insert({
    id: data.user.id,
    email,
    display_name: displayName || null,
    phone,
  });

  if (insertError) {
    return NextResponse.json(
      { error: "Account created, but failed to save profile" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, needsEmailConfirmation: !data.session });
}
