import { NextRequest, NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/ratelimit";
import { createClient } from "@/lib/supabase/server";
import { getAuthRedirectUrl } from "@/lib/site-url";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";

  if (
    email &&
    !isRateLimited(
      "resend-confirmation",
      clientIp(request.headers),
      3,
      10 * 60 * 1000
    )
  ) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: getAuthRedirectUrl("/login"),
        },
      });

      if (error) {
        console.error("Supabase confirmation resend failed", {
          code: error.code,
          status: error.status,
          message: error.message,
        });
      }
    } catch (error) {
      console.error("Supabase confirmation resend failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Keep this response generic so callers cannot discover whether an account
  // exists, is already confirmed, or is currently rate limited.
  return NextResponse.json({ ok: true });
}
