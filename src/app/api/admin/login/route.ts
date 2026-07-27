import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, isRateLimited } from "@/lib/ratelimit";
import { parseUA } from "@/lib/ua-parser";
import { geoLookup } from "@/lib/geo";

type EventPayload = {
  staffId: string | null;
  email: string;
  ip: string;
  userAgent: string | null;
  browser: string;
  os: string;
  device: string;
  success: boolean;
  failureReason: string | null;
};

// Fire-and-forget: geo lookup + insert. Never throws.
async function logLoginEvent(payload: EventPayload): Promise<void> {
  try {
    const { city, country } = await geoLookup(payload.ip);
    const admin = createAdminClient();

    const { data: inserted, error: insertError } = await admin
      .from("admin_login_events")
      .insert({
        staff_id: payload.staffId,
        email: payload.email,
        ip: payload.ip,
        user_agent: payload.userAgent,
        browser: payload.browser,
        os: payload.os,
        device: payload.device,
        city,
        country,
        success: payload.success,
        failure_reason: payload.failureReason,
      })
      .select("id")
      .single();

    if (insertError || !inserted) return;

    if (!payload.staffId) {
      // Trim null-staffId (unknown email) failure rows older than 30 days
      await admin
        .from("admin_login_events")
        .delete()
        .is("staff_id", null)
        .lt(
          "logged_at",
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        );
      return;
    }

    // Trim to 50 most-recent rows for this staff member
    const { data: toKeep } = await admin
      .from("admin_login_events")
      .select("id")
      .eq("staff_id", payload.staffId)
      .order("logged_at", { ascending: false })
      .limit(50);

    if (toKeep && toKeep.length === 50) {
      const keepIds = toKeep.map((r: { id: string }) => r.id);
      await admin
        .from("admin_login_events")
        .delete()
        .eq("staff_id", payload.staffId)
        .not("id", "in", `(${keepIds.join(",")})`);
    }
  } catch {
    // Never let logging crash the login flow
  }
}

export async function POST(request: NextRequest) {
  if (isRateLimited("admin-login", clientIp(request.headers), 8, 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const ip = clientIp(request.headers);
  const userAgent = request.headers.get("user-agent") ?? null;
  const { browser, os, device } = parseUA(userAgent);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    await logLoginEvent({
      staffId: null,
      email,
      ip,
      userAgent,
      browser,
      os,
      device,
      success: false,
      failureReason: "invalid_credentials",
    });
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    await logLoginEvent({
      staffId: data.user.id,
      email,
      ip,
      userAgent,
      browser,
      os,
      device,
      success: false,
      failureReason: "not_staff",
    });
    return NextResponse.json(
      { error: "This account does not have admin access" },
      { status: 403 }
    );
  }

  await logLoginEvent({
    staffId: data.user.id,
    email,
    ip,
    userAgent,
    browser,
    os,
    device,
    success: true,
    failureReason: null,
  });

  return NextResponse.json({ ok: true });
}
