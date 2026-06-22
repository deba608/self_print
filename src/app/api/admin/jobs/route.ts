import { NextRequest, NextResponse } from "next/server";
import { getJobsPage, getJobFilesForJobs, getPricing } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));

  const pricing = await getPricing();
  const { jobs, total } = await getJobsPage(limit, cursor);

  // files are now embedded by getJobsPage directly!
  const jobsWithFiles = jobs.map((job) => ({
    ...job,
    file: job.file ?? null,
    expiresAt: job.expiresAt
  }));

  return NextResponse.json({
    jobs: jobsWithFiles,
    cursor: jobs.length > 0 ? jobs[jobs.length - 1].createdAt : null,
    limit,
    total,
    expiryMinutes: pricing.expiryMinutes
  });
}
