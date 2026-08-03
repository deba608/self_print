import { NextRequest, NextResponse } from "next/server";
import { getAgentConfig, updateAgentConfig } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const config = await getAgentConfig();
  return NextResponse.json({
    bwPrinterName: config.bwPrinterName,
    colorPrinterName: config.colorPrinterName,
    configVersion: config.configVersion
  });
}

export async function PUT(request: NextRequest) {
  try {
    const unauthorized = await requireAdminResponse();
    if (unauthorized) return unauthorized;
    const { bwPrinterName, colorPrinterName } = await request.json();
    if (bwPrinterName === undefined && colorPrinterName === undefined) {
      return NextResponse.json({ error: "Provide bwPrinterName and/or colorPrinterName" }, { status: 400 });
    }
    if (bwPrinterName !== undefined && (typeof bwPrinterName !== "string" || !bwPrinterName.trim())) {
      return NextResponse.json({ error: "Invalid bwPrinterName" }, { status: 400 });
    }
    if (colorPrinterName !== undefined && (typeof colorPrinterName !== "string" || !colorPrinterName.trim())) {
      return NextResponse.json({ error: "Invalid colorPrinterName" }, { status: 400 });
    }
    await updateAgentConfig({
      bwPrinterName: bwPrinterName?.trim(),
      colorPrinterName: colorPrinterName?.trim()
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
