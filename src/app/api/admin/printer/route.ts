import { NextRequest, NextResponse } from "next/server";
import { getDb, getAgentConfig, updateAgentConfig } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const config = getAgentConfig();
  return NextResponse.json({ printerName: config.printerName, configVersion: config.configVersion });
}

export async function PUT(request: NextRequest) {
  try {
    const unauthorized = await requireAdminResponse();
    if (unauthorized) return unauthorized;
    const { printerName } = await request.json();
    if (!printerName || typeof printerName !== "string" || printerName.trim().length < 1) {
      return NextResponse.json({ error: "Invalid printer name" }, { status: 400 });
    }
    updateAgentConfig(printerName.trim());
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}