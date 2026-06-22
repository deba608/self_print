import { NextRequest, NextResponse } from "next/server";
import { getJobsPage, getJobFilesForJobs, getPricing } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET(request: NextRequest) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const offset = (page - 1) * limit;

  const pricing = await getPricing();
  const { jobs, total } = await getJobsPage(limit, offset);
  const filesByJob = await getJobFilesForJobs(jobs.map((job) => job.id));

  const jobsWithFiles = jobs.map((job) => ({
    ...job,
    file: filesByJob[job.id] ?? null,
    expiresAt: job.expiresAt
  }));

  return NextResponse.json({
    jobs: jobsWithFiles,
    page,
    limit,
    total,
    expiryMinutes: pricing.expiryMinutes
  });
}
