import { NextRequest, NextResponse } from "next/server";
import { cleanupOldJobs, filterActiveStoragePaths } from "@/lib/db";
import { deleteFile, listOldFiles } from "@/lib/storage";

// Deletes finished and expired jobs plus their stored files.
// Requires CRON_SECRET env var. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
// automatically. Falls back to AGENT_TOKEN only in development (NODE_ENV !== production).
function authorized(request: NextRequest): boolean {
  const isProd = process.env.NODE_ENV === "production";
  const cronSecret = process.env.CRON_SECRET;
  const agentToken = process.env.AGENT_TOKEN;

  // In production, CRON_SECRET is required — no silent fallback to dev-agent.
  const secret = cronSecret ?? (isProd ? null : (agentToken ?? "dev-agent"));
  if (!secret) return false;

  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const query = new URL(request.url).searchParams.get("key");
  return header === secret || query === secret;
}

async function runCleanup() {
  const { deleted, storagePaths } = await cleanupOldJobs();
  await Promise.all(storagePaths.map((p) => deleteFile(p)));
  
  // Clean up stray files older than 2 hours
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const oldOriginals = await listOldFiles('originals', twoHoursMs);
  const oldConverted = await listOldFiles('converted', twoHoursMs);
  const allOldPaths = [...oldOriginals, ...oldConverted];
  
  const activePaths = await filterActiveStoragePaths(allOldPaths);
  const strayPaths = allOldPaths.filter((p) => !activePaths.has(p));
  
  await Promise.all(strayPaths.map((p) => deleteFile(p)));

  return NextResponse.json({ 
    deletedJobs: deleted, 
    jobFilesRemoved: storagePaths.length,
    strayFilesRemoved: strayPaths.length 
  });
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCleanup();
}

// GET supported so Vercel Cron (which issues GET) can trigger it.
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runCleanup();
}
