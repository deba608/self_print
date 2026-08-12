import { NextRequest, NextResponse } from "next/server";
import { getJobByToken, reportJobIssue } from "@/lib/db";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

const MAX_NOTE_LEN = 500;

// Public, unauthenticated — the token is the only credential. Lets a
// customer flag a failed/cancelled order from /track without a phone call.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^\d{6}$/.test(token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  if (isRateLimited("report-issue", clientIp(request.headers), 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many reports — please wait a bit and try again." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const message = String(body?.message ?? "").trim().slice(0, MAX_NOTE_LEN);

  let job;
  try {
    job = await getJobByToken(token);
  } catch {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Only makes sense once the order has actually gone wrong — printed/queued
  // jobs should use the normal counter flow, not a support flag.
  if (!["failed", "cancelled"].includes(job.status)) {
    return NextResponse.json({ error: "This order doesn't need a report right now." }, { status: 400 });
  }

  const note = message || "Customer reported an issue (no details given).";
  await reportJobIssue(token, note);

  return NextResponse.json({ ok: true });
}
