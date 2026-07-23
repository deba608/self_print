import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthRedirectUrl } from "@/lib/site-url";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  if (isRateLimited("user-register", clientIp(request.headers), 6, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl("/login"),
      data: { display_name: displayName || null },
    },
  });

  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? "Unable to create account" }, { status: 400 });
  }

  // With email confirmation enabled, signUp() for an email that already has a
  // confirmed account returns success with an obfuscated user that has no
  // identities, rather than an error (this is Supabase's anti-enumeration
  // behavior). Don't attempt to insert a profile for it — there is no real
  // new user — and respond exactly like a fresh signup so the response can't
  // be used to probe which emails are registered.
  if (data.user.identities?.length === 0) {
    return NextResponse.json({ ok: true, needsEmailConfirmation: true });
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
    // Duplicate key (23505) means a profile row already exists for this id —
    // this is the retry-after-unconfirmed-signup case, not a real failure.
    // Respond the same as a fresh signup so this path can't be used to
    // enumerate which emails are already registered.
    if (insertError.code === "23505") {
      return NextResponse.json({ ok: true, needsEmailConfirmation: true });
    }
    return NextResponse.json(
      { error: "Account created, but failed to save profile" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, needsEmailConfirmation: !data.session });
}
