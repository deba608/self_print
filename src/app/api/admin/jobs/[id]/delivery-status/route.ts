import { NextRequest, NextResponse } from "next/server";
import { getJobById, updateDeliveryStatus, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

const allowed = ["packed", "picked_up", "out_for_delivery", "delivered"] as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
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

  await updateDeliveryStatus(id, deliveryStatus);

  const updated = await getJobById(id);
  broadcast({ type: "job_update", jobId: id, status: updated.status, deliveryStatus: updated.deliveryStatus, paidAt: updated.paidAt, token: job.token });

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

function broadcast(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(client);
    }
  }
}
