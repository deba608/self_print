import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { sseClients } from "@/lib/db";

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

  broadcast({ type: "job_update", jobId: id, deliveryStatus: next });
  return NextResponse.json({ ok: true });
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
