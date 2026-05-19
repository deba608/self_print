import { NextRequest, NextResponse } from "next/server";
import { getNextApprovedJob, getJobFile, mapJobFile } from "@/lib/db";
import { verifyAgentToken } from "@/lib/security";

export async function GET(request: NextRequest) {
  if (!verifyAgentToken(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }
  
  const job = await getNextApprovedJob();
  if (!job) return NextResponse.json({ job: null });
  
  try {
    const file = await getJobFile(job.id);
    return NextResponse.json({ job, file });
  } catch {
    return NextResponse.json({ job, file: null });
  }
}
