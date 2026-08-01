import { NextResponse } from "next/server";
import { getPricing } from "@/lib/db";

export async function GET() {
  const pricing = await getPricing();
  return NextResponse.json({
    ...pricing,
    // Trim: stray whitespace in .env (e.g. "SHOP_UPI_ID= vpa@bank") would be
    // URL-encoded into the UPI link (pa=%20vpa@bank) and rejected as an invalid VPA.
    shopUpiId: (process.env.SHOP_UPI_ID ?? "").trim(),
    shopUpiQr: (process.env.SHOP_UPI_QR ?? "").trim(),
    shopName: (process.env.SHOP_NAME ?? "Print Shop").trim(),
    shopReviewUrl: (process.env.SHOP_REVIEW_URL ?? "").trim(),
    // Publishable key id — safe on the client. Empty when Razorpay is disabled.
    razorpayKeyId: (process.env.RAZORPAY_KEY_ID ?? "").trim(),
  });
}
