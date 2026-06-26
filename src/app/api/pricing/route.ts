import { NextResponse } from "next/server";
import { getPricing } from "@/lib/db";

export async function GET() {
  const pricing = await getPricing();
  return NextResponse.json({
    ...pricing,
    shopUpiId: process.env.SHOP_UPI_ID ?? "",
    shopName: process.env.SHOP_NAME ?? "Print Shop",
  });
}
