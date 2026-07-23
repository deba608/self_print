import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ displayName: null });
    }

    const { data: profile } = await supabase
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
