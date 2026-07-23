import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthRedirectUrl } from "@/lib/site-url";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";

  if (email) {
    try {
      const supabase = await createClient();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getAuthRedirectUrl("/reset-password"),
      });
    } catch {
      // Swallow any error — never leak whether the email exists in the
      // system (locked project decision: no user enumeration).
    }
  }

  return NextResponse.json({ ok: true });
}
