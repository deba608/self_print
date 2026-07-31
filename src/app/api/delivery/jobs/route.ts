import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { DELIVERY_JOB_COLUMNS, toDeliveryOrderView, type DeliveryJobRow } from "@/lib/delivery";

export async function GET() {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: availableRows, error: availableError } = await supabase
    .from("jobs")
    .select(DELIVERY_JOB_COLUMNS)
    .eq("delivery_method", "delivery")
    .eq("status", "printed")
    .not("paid_at", "is", null)
    .is("delivery_status", null)
    .order("created_at", { ascending: true });

  const { data: mineRows, error: mineError } = await supabase
    .from("jobs")
    .select(DELIVERY_JOB_COLUMNS)
    .eq("delivery_method", "delivery")
    .eq("delivery_status", "out_for_delivery")
    .eq("delivery_person_id", staff.id)
    .order("created_at", { ascending: true });

  if (availableError || mineError) {
    return NextResponse.json({ error: "Failed to load delivery jobs" }, { status: 500 });
  }

  return NextResponse.json({
    available: ((availableRows ?? []) as unknown as DeliveryJobRow[]).map(toDeliveryOrderView),
    mine: ((mineRows ?? []) as unknown as DeliveryJobRow[]).map(toDeliveryOrderView),
  });
}
