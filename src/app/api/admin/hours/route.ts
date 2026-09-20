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

const MAX_PAUSE_MINUTES = 720; // 12h — longer closures use the acceptingOrders toggle
const MAX_PAUSE_NOTE_CHARS = 120;

// Temporary timed pause: either an explicit resume timestamp (pausedUntil,
// ISO string, or null to resume now) or a duration (pauseMinutes, server
// computes now + minutes to avoid client-clock skew). Explicit timestamp
// wins when both are sent. Absent = leave the current pause untouched.
function validatePause(body: Record<string, unknown>) {
  if (body.pausedUntil === undefined && body.pauseMinutes === undefined && body.pauseNote === undefined) {
    return { skip: true as const };
  }
  let pausedUntil: string | null = null;
  if (body.pauseMinutes !== undefined) {
    const minutes = Math.floor(Number(body.pauseMinutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_PAUSE_MINUTES) {
      return { error: `Pause duration must be between 1 and ${MAX_PAUSE_MINUTES} minutes.` };
    }
    pausedUntil = new Date(Date.now() + minutes * 60000).toISOString();
  } else if (body.pausedUntil !== undefined && body.pausedUntil !== null) {
    const until = new Date(String(body.pausedUntil));
    if (!Number.isFinite(until.getTime())) {
      return { error: "Resume time must be a valid date and time." };
    }
    if (until.getTime() <= Date.now()) {
      return { error: "Resume time must be in the future." };
    }
    if (until.getTime() - Date.now() > MAX_PAUSE_MINUTES * 60000) {
      return { error: `Pause can be at most ${MAX_PAUSE_MINUTES / 60} hours — use the Accepting orders toggle for longer closures.` };
    }
    pausedUntil = until.toISOString();
  }
  let pauseNote: string | null = null;
  if (body.pauseNote !== undefined && body.pauseNote !== null) {
    if (typeof body.pauseNote !== "string") return { error: "Pause note must be text." };
    pauseNote = body.pauseNote.trim().slice(0, MAX_PAUSE_NOTE_CHARS) || null;
  }
  return { pausedUntil, pauseNote };
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
    const pause = validatePause(body as Record<string, unknown>);
    if ("error" in pause) return NextResponse.json({ error: pause.error }, { status: 400 });

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
      pausedUntil: "skip" in pause ? current.pausedUntil : pause.pausedUntil,
      pauseNote: "skip" in pause ? current.pauseNote : pause.pauseNote,
    });

    return NextResponse.json(await getPricing());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
