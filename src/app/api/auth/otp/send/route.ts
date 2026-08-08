import { NextRequest, NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/ratelimit";
import { sendOtpForPhone } from "@/lib/otp";

export async function POST(request: NextRequest) {
  if (isRateLimited("otp-send", clientIp(request.headers), 10, 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.phone) {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  const { phone, purpose } = body;
  const result = await sendOtpForPhone({ phone: String(phone), purpose: purpose ? String(purpose) : "login" });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error, cooldownRemaining: result.cooldownRemaining },
      { status: result.cooldownRemaining ? 429 : 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "OTP code sent successfully.",
    ...(result.devCode ? { devCode: result.devCode } : {}),
  });
}
