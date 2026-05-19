import { NextResponse } from "next/server";
import { getJobs, getPricing, getJobFile } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  const pricing = await getPricing();
  const jobs = await getJobs();
  
  const jobsWithFiles = await Promise.all(
    jobs.slice(0, 100).map(async (job) => {
      try {
        const file = await getJobFile(job.id);
        return { ...job, file, expiresAt: job.expiresAt };
      } catch {
        return { ...job, file: null, expiresAt: job.expiresAt };
      }
    })
  );
  
  return NextResponse.json({ jobs: jobsWithFiles, expiryMinutes: pricing.expiryMinutes });
}
