import { NextResponse } from "next/server";
import { getCustomerManagementRows } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const customers = await getCustomerManagementRows();
  return NextResponse.json({ customers });
}
