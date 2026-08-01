import { NextResponse } from "next/server";
import { getPricing } from "@/lib/db";

export async function GET() {
  const pricing = await getPricing();
  return NextResponse.json({
    ...pricing,
    shopName: (process.env.SHOP_NAME ?? "Print Shop").trim(),
    shopReviewUrl: (process.env.SHOP_REVIEW_URL ?? "").trim(),
    // Publishable key id — safe on the client. Empty when Razorpay is disabled.
    razorpayKeyId: (process.env.RAZORPAY_KEY_ID ?? "").trim(),
  });
}
