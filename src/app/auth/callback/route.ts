import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Handles the redirect back from Supabase OAuth providers (e.g. Google).
// Exchanges the auth code for a session, then provisions a customer_profiles
// row for first-time OAuth sign-ins — normal email/password signup creates
// this row in /api/user/register instead, since OAuth users skip that form.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("customer_profiles")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile) {
    const { error: insertError } = await admin.from("customer_profiles").insert({
      id: data.user.id,
      email: data.user.email ?? "",
      display_name: data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? null,
      phone: null,
    });

    if (insertError && insertError.code !== "23505") {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=oauth_profile_failed`);
    }
  }

  return NextResponse.redirect(`${origin}/my-jobs`);
}
