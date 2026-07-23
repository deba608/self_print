import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

export async function POST(request: NextRequest) {
  // Stricter than customer login — admin access is a higher-value target.
  if (isRateLimited("admin-login", clientIp(request.headers), 8, 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "This account does not have admin access" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
