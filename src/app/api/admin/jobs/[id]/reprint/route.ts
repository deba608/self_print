import { NextRequest, NextResponse } from "next/server";
import { getJobById, queueReprint } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  
  let job;
  try {
    job = await getJobById(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  
  if (job.needsConversion) return NextResponse.json({ error: "Job needs conversion before reprint" }, { status: 400 });
  if (job.status !== "printed" && job.status !== "failed") return NextResponse.json({ error: "Only printed or failed jobs can be queued for reprint" }, { status: 400 });
  
  await queueReprint(id);

  const updated = await getJobById(id);
  return NextResponse.json({ ok: true, job: updated });
}
