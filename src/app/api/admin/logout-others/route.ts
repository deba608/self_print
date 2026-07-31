import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireStaffResponse } from "@/lib/security";

// Revokes every refresh token for this staff member EXCEPT the one behind the
// current request's cookies (scope: "others") — lets a staff member kick a
// lost/stolen device or an old browser session without logging themselves out.
export async function POST() {
  const unauthorized = await requireStaffResponse();
  if (unauthorized) return unauthorized;

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "others" });

  if (error) {
    return NextResponse.json({ error: "Unable to sign out other sessions" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
