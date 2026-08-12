import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";

const allowed = ["out_for_delivery", "delivered"] as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const next = body?.next;
  if (!allowed.includes(next)) {
    return NextResponse.json({ error: "Unsupported delivery status" }, { status: 400 });
  }
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("advance_delivery_job", { p_job_id: id, p_next: next });
  if (error) {
    return NextResponse.json({ error: "Failed to update delivery" }, { status: 500 });
  }
  if (data === 1) {
    return NextResponse.json({ error: "You did not claim this order." }, { status: 403 });
  }
  if (data === 2) {
    return NextResponse.json({ error: "This order can't move to that step." }, { status: 400 });
  }

  // Notify customer on delivery status change (WhatsApp primary, SMS fallback — failures never block)
  try {
    const { getJobById } = await import("@/lib/db");
    const { sendOutForDeliverySms, sendDeliveredSms } = await import("@/lib/sms-notifications");
    const { sendOutForDeliveryWa, sendDeliveredWa } = await import("@/lib/whatsapp-notifications");
    const job = await getJobById(id);
    if (job?.customerPhone) {
      const input = {
        phone: job.customerPhone,
        token: job.token,
        driverName: staff.displayName || "Delivery Executive",
        driverPhone: undefined,
      };
      if (next === "out_for_delivery") {
        await Promise.allSettled([sendOutForDeliveryWa(input), sendOutForDeliverySms(input)]);
      } else if (next === "delivered") {
        await Promise.allSettled([sendDeliveredWa(input), sendDeliveredSms(input)]);
      }
    }
  } catch (err) {
    console.warn("Failed to dispatch delivery status notification:", err);
  }

  return NextResponse.json({ ok: true });
}
