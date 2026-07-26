import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthRedirectUrl } from "@/lib/site-url";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  if (isRateLimited("forgot-password", clientIp(request.headers), 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";

  if (!email) {
    return NextResponse.json({ error: "Please enter your email" }, { status: 400 });
  }

  // Check account exists via admin client so we can show a real error.
  const admin = createAdminClient();
  const { data: usersData } = await admin.auth.admin.listUsers();
  const exists = usersData?.users?.some(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  ) ?? false;

  if (!exists) {
    return NextResponse.json({ error: "No account found for that email." }, { status: 404 });
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getAuthRedirectUrl("/reset-password"),
    });

    if (error) {
      console.error("Supabase password reset email failed", {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      return NextResponse.json({ error: "Failed to send reset email. Try again." }, { status: 500 });
    }
  } catch (error) {
    console.error("Supabase password reset email failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to send reset email. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
