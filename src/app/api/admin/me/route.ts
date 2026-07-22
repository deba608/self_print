import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  return NextResponse.json(admin);
}
