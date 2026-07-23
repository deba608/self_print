import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  if (isRateLimited("user-login", clientIp(request.headers), 10, 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { email, password } = body;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email ?? ""),
    password: String(password ?? ""),
  });

  if (error || !data.user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    // Unlike staff login, we do NOT sign out here: this Supabase account may
    // simply not be a customer account (e.g. a staff account used on the
    // wrong login page), not an invalid/compromised session.
    return NextResponse.json(
      { error: "This account is not registered as a customer" },
      { status: 403 }
    );
  }

  return NextResponse.json({ ok: true });
}
