import { NextRequest, NextResponse } from "next/server";
import { getJobById, updateDeliveryStatus, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

const allowed = ["out_for_delivery", "delivered"] as const;

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

  await updateDeliveryStatus(id, deliveryStatus);

  const updated = await getJobById(id);
  broadcast({ type: "job_update", jobId: id, status: updated.status, deliveryStatus: updated.deliveryStatus, paidAt: updated.paidAt, token: job.token });

  return NextResponse.json({ ok: true, job: updated });
}

function invalidTransition(current: string | null, printStatus: string, next: string) {
  if (next === "out_for_delivery") {
    if (printStatus !== "printed") return "Job must be printed before it can go out for delivery.";
    if (current === "delivered") return "This job was already delivered.";
    return "";
  }
  // next === "delivered"
  if (current !== "out_for_delivery") return "Mark it out for delivery first.";
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
