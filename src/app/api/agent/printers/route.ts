import { NextRequest, NextResponse } from "next/server";
import { replaceAgentPrinters } from "@/lib/db";
import { verifyAgentToken } from "@/lib/security";
import type { PrinterOption } from "@/lib/types";

type IncomingPrinter = Partial<Omit<PrinterOption, "seenAt">>;

export async function POST(request: NextRequest) {
  if (!verifyAgentToken(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  const body = await request.json();
  const printers: IncomingPrinter[] = Array.isArray(body.printers) ? body.printers : [];
  const normalized = printers
    .map(normalizePrinter)
    .filter((printer): printer is Omit<PrinterOption, "seenAt"> => Boolean(printer))
    .slice(0, 100);

  await replaceAgentPrinters(normalized);
  return NextResponse.json({ ok: true, count: normalized.length });
}

function normalizePrinter(printer: IncomingPrinter) {
  const name = String(printer.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    driverName: String(printer.driverName ?? "").trim(),
    portName: String(printer.portName ?? "").trim(),
    isDefault: Boolean(printer.isDefault)
  };
}
