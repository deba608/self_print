import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
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
let updating = false;

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
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${payload}" -Force`,
  ]);
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
 * running; only the very last step (bat spawned) exits this process.
 */
export async function checkForUpdateCommand(): Promise<void> {
  if (updating) return;
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

  updating = true;
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
    const child = spawn("cmd.exe", ["/c", batPath], { detached: true, stdio: "ignore", windowsHide: true });
    // If the spawn itself fails we must NOT exit — nothing would restart us.
    let spawnFailed = false;
    child.on("error", (e) => {
      spawnFailed = true;
      deps.log(`Failed to launch updater.bat (staying on ${mine}): ${e.message}`);
    });
    child.unref();
    setTimeout(() => {
      if (!spawnFailed) {
        process.exit(0);
        return;
      }
      updating = false;
      void fs.rm(path.join(shopRoot, "update-pending.txt"), { force: true }).catch(() => undefined);
      void setStatus("failed", "could not launch updater.bat").catch(() => undefined);
      void audit(mine, target, "failed", "could not launch updater.bat").catch(() => undefined);
    }, 500); // give the spawn a beat to detach
  } catch (err) {
    updating = false;
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
    }
    await fs.rm(pendingMarker, { force: true });
  }
  // Always report the running version + clear stale in-flight status from a crash.
  await (deps.supabase.from("agent_config") as any)
    .update({ agent_version: mine, updated_at: new Date().toISOString() })
    .eq("id", 1);
}

/** Health heartbeat — the file updater.bat waits for after a swap. */
export async function writeHealthHeartbeat(): Promise<void> {
  const mine = currentVersion();
  await fs.writeFile(path.join(shopRoot, "agent-health.txt"), mine);
  await (deps.supabase.from("agent_config") as any)
    .update({ agent_healthy_at: new Date().toISOString(), agent_version: mine })
    .eq("id", 1);
}
