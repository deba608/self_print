import { NextRequest, NextResponse } from "next/server";
import { getJobById, updateDeliveryStatus } from "@/lib/db";
import { requireAdmin } from "@/lib/security";

const allowed = ["packed", "picked_up", "out_for_delivery", "delivered"] as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const deliveryStatus = body?.deliveryStatus;
  if (!body || !allowed.includes(deliveryStatus)) {
    return NextResponse.json({ error: "Unsupported delivery status" }, { status: 400 });
  }
  const { id } = await params;

  let job;
  try {
    job = await getJobById(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.deliveryMethod !== "delivery") {
    return NextResponse.json({ error: "This job is not a delivery order" }, { status: 400 });
  }
  const invalid = invalidTransition(job.deliveryStatus, job.status, deliveryStatus);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  // Defense-in-depth alongside the release-time check: never dispatch an
  // unpaid delivery order (there is no cash-on-delivery flow).
  if ((deliveryStatus === "picked_up" || deliveryStatus === "out_for_delivery") && !job.paidAt) {
    return NextResponse.json({ error: "Delivery orders must be paid before dispatch." }, { status: 400 });
  }

  // The rider flow (claim_delivery_job) always sets delivery_person_id when it
  // sets delivery_status. This route bypasses that flow — staff can dispatch
  // directly without a rider claiming in-app (e.g. delivering it themselves,
  // or claiming on the rider's behalf). Without this, such an order would go
  // out_for_delivery/delivered with no rider on record: invisible to every
  // rider's "my deliveries" list and impossible to hold anyone accountable
  // for. Self-assign the acting admin the first time the job moves past
  // "packed" — never overwrite a rider who already claimed it.
  const needsAssignment =
    (deliveryStatus === "picked_up" || deliveryStatus === "out_for_delivery" || deliveryStatus === "delivered") &&
    !job.deliveryPersonId;

  await updateDeliveryStatus(id, deliveryStatus, needsAssignment ? admin.id : undefined);

  const updated = await getJobById(id);

  return NextResponse.json({ ok: true, job: updated });
}

// Flow: printed → packed → picked_up → out_for_delivery → delivered.
// Admin may skip forward (e.g. straight to out_for_delivery) but never move
// a delivered order, and nothing moves before the job is printed.
function invalidTransition(current: string | null, printStatus: string, next: string) {
  if (printStatus !== "printed") return "Job must be printed first.";
  if (current === "delivered") return "This job was already delivered.";
  if (next === "delivered" && current !== "out_for_delivery") {
    return "Mark it out for delivery first.";
  }
  const order = [null, "pending", "packed", "picked_up", "out_for_delivery", "delivered"];
  if (order.indexOf(next) <= order.indexOf(current ?? null) && current !== "pending") {
    return "Delivery status can only move forward.";
  }
  return "";
}
