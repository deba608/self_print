import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { sseClients } from "@/lib/db";

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

  broadcast({ type: "job_update", jobId: id, deliveryStatus: "out_for_delivery" });
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
