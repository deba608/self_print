import { NextRequest, NextResponse } from "next/server";
import { getJobById, resolveJobIssue } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;

  try {
    await getJobById(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  await resolveJobIssue(id);
  return NextResponse.json({ ok: true });
}
