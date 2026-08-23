import { NextRequest, NextResponse } from "next/server";
import { getPricing, updatePricing } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const daysPattern = /^[1-7](,[1-7]){0,6}$/;

function validateWindow(open: unknown, close: unknown, label: string) {
  const o = open ?? null;
  const c = close ?? null;
  if ((o && !timePattern.test(o as string)) || (c && !timePattern.test(c as string))) {
    return { error: `${label} must be in HH:MM format.` };
  }
  if ((o && !c) || (!o && c)) {
    return { error: `Set both a start and end time for ${label.toLowerCase()}, or clear both.` };
  }
  return { open: (o as string | null) ?? null, close: (c as string | null) ?? null };
}

function validateDays(days: unknown, label: string) {
  if (days === undefined) return { skip: true as const };
  if (days !== null && (typeof days !== "string" || !daysPattern.test(days))) {
    return { error: `${label} must be comma-separated weekdays 1-7.` };
  }
  return { days: days as string | null };
}

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  return NextResponse.json(await getPricing());
}

// Standalone endpoint for the Service Hours panel — only touches the
// pickup/delivery hours fields, so it doesn't need the full pricing PUT's
// "every numeric field required" validation.
export async function PUT(request: NextRequest) {
  try {
    const unauthorized = await requireAdminResponse();
    if (unauthorized) return unauthorized;
    const body = await request.json();
    const current = await getPricing();

    const pickup1 = validateWindow(body.orderOpenTime, body.orderCloseTime, "Pickup window");
    if ("error" in pickup1) return NextResponse.json({ error: pickup1.error }, { status: 400 });
    const pickup2 = validateWindow(body.orderOpenTime2, body.orderCloseTime2, "Pickup second window");
    if ("error" in pickup2) return NextResponse.json({ error: pickup2.error }, { status: 400 });
    const delivery = validateWindow(body.deliveryOpenTime, body.deliveryCloseTime, "Delivery window");
    if ("error" in delivery) return NextResponse.json({ error: delivery.error }, { status: 400 });

    const orderDays = validateDays(body.orderDays, "Pickup days");
    if ("error" in orderDays) return NextResponse.json({ error: orderDays.error }, { status: 400 });
    const deliveryDays = validateDays(body.deliveryDays, "Delivery days");
    if ("error" in deliveryDays) return NextResponse.json({ error: deliveryDays.error }, { status: 400 });

    await updatePricing({
      ...current,
      acceptingOrders: typeof body.acceptingOrders === "boolean" ? body.acceptingOrders : current.acceptingOrders,
      orderOpenTime: pickup1.open,
      orderCloseTime: pickup1.close,
      orderOpenTime2: pickup2.open,
      orderCloseTime2: pickup2.close,
      orderDays: "skip" in orderDays ? current.orderDays : orderDays.days,
      deliveryOpenTime: delivery.open,
      deliveryCloseTime: delivery.close,
      deliveryDays: "skip" in deliveryDays ? current.deliveryDays : deliveryDays.days,
    });

    return NextResponse.json(await getPricing());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
