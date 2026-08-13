import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ displayName: null });
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("customer_profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();

    return NextResponse.json({
      displayName: profile?.display_name || user.email || null,
    });
  } catch {
    return NextResponse.json({ displayName: null });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const checkOnly = body?.checkOnly === true;

    if (!phone) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    // Basic phone validation — digits, spaces, +, -, (, )
    if (!/^[+\d][\d\s\-().]{6,19}$/.test(phone)) {
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
    }

    // Check if this phone is already used by another account
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("customer_profiles")
      .select("id")
      .eq("phone", phone)
      .neq("id", user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "This mobile number is already registered to another account." },
        { status: 409 }
      );
    }

    // checkOnly=true is used by the blur-time duplicate check; don't persist
    if (checkOnly) {
      return NextResponse.json({ ok: true, available: true });
    }

    const { error } = await supabase
      .from("customer_profiles")
      .update({ phone })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json({ error: "Unable to save phone number" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}


