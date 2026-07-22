import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";

  if (email) {
    try {
      const supabase = await createClient();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/reset-password`,
      });
    } catch {
      // Swallow any error — never leak whether the email exists in the
      // system (locked project decision: no user enumeration).
    }
  }

  return NextResponse.json({ ok: true });
}
