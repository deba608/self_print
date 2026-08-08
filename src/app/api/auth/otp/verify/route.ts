import { NextRequest, NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/ratelimit";
import { verifyOtpCode } from "@/lib/otp";

export async function POST(request: NextRequest) {
  if (isRateLimited("otp-verify", clientIp(request.headers), 15, 60 * 1000)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.phone || !body.code) {
    return NextResponse.json({ error: "Phone number and 6-digit OTP code are required" }, { status: 400 });
  }

  const { phone, code, purpose } = body;
  const result = await verifyOtpCode({
    phone: String(phone),
    code: String(code),
    purpose: purpose ? String(purpose) : "login",
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error || "Verification failed" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message: "Phone number verified successfully." });
}
