import { NextResponse } from "next/server";
import { getPricing } from "@/lib/db";

export async function GET() {
  const pricing = await getPricing();
  return NextResponse.json({
    ...pricing,
    shopUpiId: process.env.SHOP_UPI_ID ?? "",
    shopUpiQr: process.env.SHOP_UPI_QR ?? "",
    shopName: process.env.SHOP_NAME ?? "Print Shop",
  });
}
