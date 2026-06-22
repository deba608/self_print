import { NextRequest, NextResponse } from "next/server";
import { cleanupOldJobs } from "@/lib/db";
import { deleteFile } from "@/lib/storage";

// Deletes finished and expired jobs plus their stored files.
// Protect with CRON_SECRET (falls back to AGENT_TOKEN). Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is set.
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.AGENT_TOKEN ?? "dev-agent";
  const header = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const query = new URL(request.url).searchParams.get("key");
  return header === secret || query === secret;
}

async function runCleanup() {
  const { deleted, storagePaths } = await cleanupOldJobs();
  await Promise.all(storagePaths.map((p) => deleteFile(p)));
  return NextResponse.json({ deleted, filesRemoved: storagePaths.length });
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
