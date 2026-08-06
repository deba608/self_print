import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compareVersions, parseLatestJson, sha256Hex } from "./update-lib";

// File/path contract shared with agent/updater-template.bat — keep in sync.
const shopRoot = path.resolve(process.cwd(), "..");
const stagingDir = path.join(shopRoot, "update-staging");
const agentDir = path.join(process.cwd(), "agent");

type UpdaterDeps = {
  supabase: SupabaseClient;
  log: (m: string) => void;
  isProcessing: () => boolean;
};

let deps: UpdaterDeps;
// Synchronous in-flight guard. A boolean set after the first `await` would let
// the SUBSCRIBED one-shot and the interval tick both past it while the initial
// select is still resolving, racing two updaters.
let inFlight: Promise<void> | null = null;
// Set once the updater task is launched: this process is about to exit, so never start
// another check even if a timer fires in the handoff window.
let handedOff = false;

export function initUpdater(d: UpdaterDeps) {
  deps = d;
}

export function currentVersion(): string {
  return JSON.parse(readFileSync(path.join(agentDir, "version.json"), "utf8")).version as string;
}

/** Verify sha256 then extract the zip into `<dir>/payload`. Throws (leaving nothing extracted) on mismatch. */
export async function stageUpdate(zipBytes: Buffer, expectedSha: string, dir: string): Promise<void> {
  const actual = sha256Hex(zipBytes);
  if (actual !== expectedSha) throw new Error(`sha256 mismatch: expected ${expectedSha}, got ${actual}`);
  const zipPath = path.join(dir, "update.zip");
  const payload = path.join(dir, "payload");
  await fs.rm(payload, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(zipPath, zipBytes);
  // $ErrorActionPreference='Stop': Expand-Archive can otherwise exit 0 after a
  // non-terminating error, leaving a partial payload that we would then swap in.
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `$ErrorActionPreference='Stop'; Expand-Archive -Path "${zipPath}" -DestinationPath "${payload}" -Force`,
  ]);
  // Both kinds ship an agent/ directory (the bat copies payload\agent for "code"
  // and payload\* for "full"). No version.json means the extraction is incomplete.
  if (!existsSync(path.join(payload, "agent", "version.json"))) {
    await fs.rm(payload, { recursive: true, force: true });
    throw new Error("extracted payload is incomplete: agent/version.json missing");
  }
}

/** Name of the one-shot task that runs the swap script. Shared with the bat. */
export const UPDATER_TASK = "SelfPrintUpdater";

/**
 * Run updater.bat OUTSIDE this process tree.
 *
 * The bat's first action is `schtasks /End /TN SelfPrintAgent`, which terminates
 * that task instance's entire job object. A child of ours — even spawned with
 * detached: true, which does NOT break out of a Windows job object — would be
 * killed along with the agent, mid-swap. Registering our own one-shot task makes
 * the updater a child of the Task Scheduler service instead.
 *
 * Throws if either schtasks call fails (execFileSync throws on a non-zero exit).
 */
export function launchUpdaterTask(batPath: string): void {
  execFileSync(
    "schtasks",
    [
      "/Create", "/TN", UPDATER_TASK,
      "/TR", `cmd /c "${batPath}"`,
      "/SC", "ONCE", "/ST", "00:00",
      "/RL", "HIGHEST", "/F",
    ],
    { stdio: "ignore" },
  );
  execFileSync("schtasks", ["/Run", "/TN", UPDATER_TASK], { stdio: "ignore" });
}

export function renderUpdaterBat(
  template: string,
  vars: { root: string; kind: "code" | "full"; version: string },
): string {
  return template
    .replaceAll("{{ROOT}}", vars.root)
    .replaceAll("{{KIND}}", vars.kind)
    .replaceAll("{{VERSION}}", vars.version);
}

async function setStatus(status: string, message?: string) {
  await (deps.supabase.from("agent_config") as any)
    .update({ update_status: status, update_message: message ?? null, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

async function audit(from: string | null, to: string | null, status: string, message?: string) {
  await (deps.supabase.from("agent_update_events") as any)
    .insert([{ from_version: from, to_version: to, status, message: message ?? null }]);
}

/**
 * Full update pipeline. Every failure branch returns with the OLD version still
 * running; only the very last step (updater task launched) exits this process.
 */
export function checkForUpdateCommand(): Promise<void> {
  if (handedOff) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = runUpdateCheck().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runUpdateCheck(): Promise<void> {
  const mine = currentVersion();
  const { data, error } = (await deps.supabase
    .from("agent_config")
    .select("update_target_version, update_status")
    .eq("id", 1)
    .single()) as any;
  if (error || !data?.update_target_version) return;
  if (data.update_status !== "requested") return;
  if (compareVersions(data.update_target_version, mine) === 0) {
    await setStatus("success", "already on this version");
    return;
  }
  if (deps.isProcessing()) {
    deps.log("Update requested but a job is printing — retrying next poll.");
    return;
  }

  const target = data.update_target_version as string;
  try {
    deps.log(`Update ${mine} -> ${target}: downloading manifest...`);
    await setStatus("downloading");
    const { data: manifestBlob, error: mErr } = await deps.supabase.storage
      .from("agent-updates")
      .download("latest.json");
    if (mErr || !manifestBlob) throw new Error(`latest.json download failed: ${mErr?.message}`);
    const latest = parseLatestJson(await manifestBlob.text());
    if (latest.version !== target) throw new Error(`latest.json has ${latest.version}, target is ${target}`);

    const { data: zipBlob, error: zErr } = await deps.supabase.storage
      .from("agent-updates")
      .download(latest.file);
    if (zErr || !zipBlob) throw new Error(`${latest.file} download failed: ${zErr?.message}`);
    await stageUpdate(Buffer.from(await zipBlob.arrayBuffer()), latest.sha256, stagingDir);

    const template = await fs.readFile(path.join(agentDir, "updater-template.bat"), "utf8");
    const bat = renderUpdaterBat(template, { root: shopRoot, kind: latest.kind, version: target });
    const batPath = path.join(stagingDir, "run-update.bat");
    await fs.writeFile(batPath, bat);
    await fs.writeFile(path.join(shopRoot, "update-pending.txt"), `${mine} ${target}`);

    await setStatus("swapping");
    deps.log("Update staged; handing off to updater.bat and exiting.");
    handedOff = true;
    try {
      launchUpdaterTask(batPath);
    } catch (e) {
      // Nothing was swapped yet — fall into the catch below, old version lives on.
      handedOff = false;
      throw new Error(
        `could not launch the ${UPDATER_TASK} task: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    setTimeout(() => process.exit(0), 500); // let the task actually start
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log(`Update failed (old version keeps running): ${msg}`);
    // Best-effort reporting: never let a reporting error escape and kill the agent.
    await setStatus("failed", msg).catch(() => undefined);
    await audit(mine, target, "failed", msg).catch(() => undefined);
    // Leave no half-staged payload behind for the next attempt.
    await fs.rm(path.join(shopRoot, "update-pending.txt"), { force: true }).catch(() => undefined);
    await fs.rm(path.join(stagingDir, "payload"), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Startup: report the outcome of a swap that happened while we were down. */
export async function reportPostUpdateStatus(): Promise<void> {
  const mine = currentVersion();
  const rollbackMarker = path.join(shopRoot, "update-rollback.txt");
  const pendingMarker = path.join(shopRoot, "update-pending.txt");
  if (existsSync(rollbackMarker)) {
    const reason = (await fs.readFile(rollbackMarker, "utf8")).trim();
    const pending = existsSync(pendingMarker)
      ? (await fs.readFile(pendingMarker, "utf8")).trim().split(" ")
      : [null, null];
    await setStatus("rolled_back", reason);
    await audit(pending[0], pending[1], "rolled_back", reason);
    await fs.rm(rollbackMarker, { force: true });
    await fs.rm(pendingMarker, { force: true });
    deps.log(`Previous update rolled back: ${reason}`);
  } else if (existsSync(pendingMarker)) {
    const [from, to] = (await fs.readFile(pendingMarker, "utf8")).trim().split(" ");
    if (to === mine) {
      await setStatus("success");
      await audit(from, to, "success");
      deps.log(`Update to ${mine} succeeded.`);
    } else {
      // Power loss mid-swap: the bat never finished, so it wrote no rollback
      // marker. Without this the status stays "swapping" forever and blocks
      // every future update.
      const msg = `update did not complete; still on ${mine}`;
      await setStatus("failed", msg);
      await audit(from ?? null, to ?? null, "failed", msg);
      deps.log(`Previous update did not complete (still on ${mine}).`);
    }
    await fs.rm(pendingMarker, { force: true });
  }
  // Always report the running version + clear stale in-flight status from a crash.
  await (deps.supabase.from("agent_config") as any)
    .update({ agent_version: mine, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

/**
 * Exact bytes of the heartbeat file.
 * The trailing CRLF is REQUIRED: updater.bat matches with `findstr /X`, and
 * findstr will not match the final line of a file that has no line terminator
 * (verified on this Windows build — a bare "1.1.0" never matches).
 */
export function heartbeatContent(version: string): string {
  return `${version}\r\n`;
}

/** Health heartbeat — the file updater.bat waits for after a swap. */
export async function writeHealthHeartbeat(): Promise<void> {
  const mine = currentVersion();
  await fs.writeFile(path.join(shopRoot, "agent-health.txt"), heartbeatContent(mine));
  await (deps.supabase.from("agent_config") as any)
    .update({ agent_healthy_at: new Date().toISOString(), agent_version: mine })
    .eq("id", 1);
}
