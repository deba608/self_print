import { NextRequest, NextResponse } from "next/server";
import { getAgentConfig } from "@/lib/db";
import { verifyAgentToken } from "@/lib/security";

export async function GET(request: NextRequest) {
  if (!(await verifyAgentToken(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }
  const config = await getAgentConfig();
  return NextResponse.json({ printerName: config.printerName, configVersion: config.configVersion });
}
