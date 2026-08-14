import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/user/guest-session
 * Lightweight registration for guest users who have not signed in.
 * Stores name + phone so the admin can identify them and contact them
 * about their print order. The data is also passed through to each job
 * at submission time via the form fields guestName / guestPhone.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const name = String(body.name ?? "").trim().slice(0, 80);
    const phone = String(body.phone ?? "").replace(/\D/g, "").slice(0, 10);

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (phone.length !== 10) return NextResponse.json({ error: "Invalid phone" }, { status: 400 });

    // In Supabase-backed production the guest profile can be recorded in
    // customer_profiles (or a future guest_sessions table). For now this
    // endpoint is intentionally lightweight: the authoritative storage of
    // name/phone happens when the job is submitted (customer_name /
    // customer_phone columns). This endpoint exists so the client can
    // signal intent and for future server-side logging/analytics.
    return NextResponse.json({ ok: true, name, phone });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
