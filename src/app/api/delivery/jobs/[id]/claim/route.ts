import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_delivery_job", { p_job_id: id });
  if (error) {
    return NextResponse.json({ error: "Failed to claim delivery" }, { status: 500 });
  }
  if (data === 1) {
    return NextResponse.json({ error: "Another rider already claimed this order." }, { status: 409 });
  }
  if (data === 2) {
    return NextResponse.json({ error: "This order is not ready for delivery." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
