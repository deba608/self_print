import { NextRequest, NextResponse } from "next/server";
import { getJobByToken } from "@/lib/db";

// Public payment-status poll for the customer's token screen. Exposes only
// the job's status and paid time — nothing else — so the phone can flip to
// the receipt the moment staff marks a cash/QR payment as paid.
export async function GET(_: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  try {
    const job = await getJobByToken(token);
    return NextResponse.json(
      { status: job.status, paidAt: job.paidAt },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
