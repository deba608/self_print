import { NextResponse } from "next/server";
import { getJobSummary } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  
  const summary = await getJobSummary();
  return NextResponse.json(summary);
}
