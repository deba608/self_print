import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { getAgentUpdateState, requestAgentUpdate } from "@/lib/db";
import { createClient } from "@supabase/supabase-js";

// Statuses that mean the agent is mid-upgrade — a second request would
// stomp the target version out from under a download or swap in progress.
const IN_FLIGHT = ["requested", "downloading", "swapping"];

function serviceClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * The published manifest, or null when nothing has been published yet (or the
 * bucket is unreachable). Deliberately swallows errors: the dashboard should
 * still render the agent's own state when Storage is down, and POST already
 * refuses to queue anything when this returns null.
 */
async function fetchLatest() {
  try {
    const client = serviceClient();
    const { data } = await client.storage.from("agent-updates").download("latest.json");
    if (!data) return null;
    const j = JSON.parse(await data.text());

    // Payload size is metadata-only, so a failure here must not lose the
    // manifest — the UI just shows the version without a size.
    let sizeKb: number | null = null;
    try {
      const { data: files } = await client.storage
        .from("agent-updates")
        .list("", { search: j.file });
      const bytes = files?.find((f) => f.name === j.file)?.metadata?.size;
      if (typeof bytes === "number") sizeKb = Math.round(bytes / 1024);
    } catch {
      // keep sizeKb null
    }

    return { version: j.version, kind: j.kind, publishedAt: j.publishedAt, sizeKb };
  } catch {
    return null;
  }
}

export async function GET() {
  const staff = await requireStaff();
  if (!staff || staff.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin required" }, { status: 401 });
  }
  const [state, latest] = await Promise.all([getAgentUpdateState(), fetchLatest()]);
  return NextResponse.json({ state, latest });
}

export async function POST() {
  const staff = await requireStaff();
  if (!staff || staff.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin required" }, { status: 401 });
  }
  const [state, latest] = await Promise.all([getAgentUpdateState(), fetchLatest()]);
  if (!latest) {
    return NextResponse.json({ error: "No published update found" }, { status: 400 });
  }
  if (IN_FLIGHT.includes(state.updateStatus ?? "")) {
    return NextResponse.json(
      { error: `Update already in progress (${state.updateStatus})` },
      { status: 409 }
    );
  }
  if (state.agentVersion === latest.version) {
    return NextResponse.json({ error: `Agent already on ${latest.version}` }, { status: 400 });
  }
  await requestAgentUpdate(latest.version);
  return NextResponse.json({ success: true, targetVersion: latest.version });
}
