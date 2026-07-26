import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!phone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("customer_profiles")
    .update({ phone })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "Unable to save phone number" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
