import { NextResponse } from "next/server";
import { getAgentConfig, getAgentPrinters } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const config = await getAgentConfig();
  const printers = await getAgentPrinters();
  return NextResponse.json({
    selectedPrinterName: config.printerName,
    printers
  });
}
