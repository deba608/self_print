import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthRedirectUrl } from "@/lib/site-url";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  // Rate-limited before the email check so this can't be used to spam an
  // arbitrary inbox with reset emails from a single source either.
  if (isRateLimited("forgot-password", clientIp(request.headers), 5, 60 * 60 * 1000)) {
    return NextResponse.json({ ok: true });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";

  if (email) {
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
      }
    } catch (error) {
      console.error("Supabase password reset email failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      // Swallow any error — never leak whether the email exists in the
      // system (locked project decision: no user enumeration).
    }
  }

  return NextResponse.json({ ok: true });
}
