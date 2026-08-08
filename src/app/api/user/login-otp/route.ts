import { NextRequest, NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/ratelimit";
import { verifyOtpCode } from "@/lib/otp";
import { normalizePhoneNumber } from "@/lib/sms";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  if (isRateLimited("user-login-otp", clientIp(request.headers), 10, 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.phone || !body.code) {
    return NextResponse.json({ error: "Phone number and OTP code are required" }, { status: 400 });
  }

  const phone = normalizePhoneNumber(String(body.phone));
  const code = String(body.code);

  const verification = await verifyOtpCode({ phone, code, purpose: "login" });
  if (!verification.success) {
    return NextResponse.json({ error: verification.error || "Invalid OTP code" }, { status: 400 });
  }

  const isSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (isSupabase) {
    try {
      const admin = createAdminClient();
      // Search customer profiles for matching phone
      const { data: profile } = await admin
        .from("customer_profiles")
        .select("id, display_name, email, phone")
        .eq("phone", phone)
        .maybeSingle();

      if (!profile) {
        // Auto-provision customer profile for new mobile user
        const syntheticEmail = `phone_${phone.replace(/\D/g, "")}@selfprint.local`;
        const { data: newUser, error: createError } = await admin.auth.admin.createUser({
          email: syntheticEmail,
          phone: phone,
          email_confirm: true,
          phone_confirm: true,
          user_metadata: { phone },
        });

        if (newUser?.user) {
          await admin.from("customer_profiles").insert({
            id: newUser.user.id,
            email: syntheticEmail,
            display_name: body.displayName ? String(body.displayName).trim() : `Customer (${phone.slice(-4)})`,
            phone: phone,
          });
        }
      }
    } catch (err) {
      console.warn("Mobile OTP user profile provisioning warning:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    phone,
    message: "Logged in successfully via mobile OTP",
  });
}
