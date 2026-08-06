# Agent Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the shop-PC print agent update itself from Supabase Storage when the developer presses a button in the admin dashboard, with sha256 verification, health-check-gated rollback, and zero client action.

**Architecture:** Publisher (`package-for-shop.mjs --publish`) uploads versioned zips + `latest.json` to a private `agent-updates` bucket. Agent polls `agent_config` (existing cadence), downloads/verifies/stages, spawns a detached `updater.bat`, and exits; the bat swaps folders, restarts the scheduled task, and rolls back unless the new agent writes a local health heartbeat. Trigger = dashboard card (super_admin) or CLI, both writing the same `agent_config` columns.

**Tech Stack:** Node 20 (tsx), Supabase JS + Storage, Windows batch, Next.js 15 App Router, vitest.

**Spec:** `docs/superpowers/specs/2026-08-06-agent-self-update-design.md` — read it first.

## Global Constraints

- `config.json` is NEVER included in any update payload and MUST be preserved across swaps (holds service-role key + shop printer settings).
- Every failure branch must leave the OLD agent running. Worst case = stale agent, never a dead shop.
- Update payload kinds: `"code"` (agent/ only, no node_modules) and `"full"` (agent/ + minimal node_modules). Never `npm install` on the shop PC.
- `updateMode` config values: `"manual"` (implemented) | `"auto"` | `"window"` (reserved — agent exits at startup with clear log if set, so they can't silently half-work).
- Bucket `agent-updates` is PRIVATE. Agent downloads with its service-role key.
- `latest.json` uploads LAST during publish; publish REFUSES to overwrite an existing version zip.
- Update status values (exact strings): `requested | downloading | swapping | success | failed | rolled_back`.
- Directory layout on shop PC (from existing packager): `<root>/SETUP.bat`, `<root>/engine/` (cwd of running agent), `<root>/engine/agent/…`. All update scratch state lives at `<root>/update-staging/` and `<root>/*.txt` markers — NEVER inside `engine/` (engine gets renamed during swap).
- Path derivation inside the agent: `const shopRoot = path.resolve(process.cwd(), "..")` (agent cwd is `engine/`, per `SETUP.bat`'s `cd /d "%~dp0.."`). In dev (repo checkout) `shopRoot` is the folder above the repo — updater code must therefore only ever RUN swaps when packaged; dev runs just log.
- Commit after every task. Run `npm run typecheck` and `npm run test` before each commit.

## File Structure

| File | Responsibility |
|---|---|
| `agent/version.json` (create) | `{ "version": "1.0.0" }` — running-version source of truth |
| `agent/src/update-lib.ts` (create) | Pure helpers: semver compare, `latest.json` validation, sha256 — no I/O, fully unit-tested |
| `agent/src/update-lib.test.ts` (create) | Vitest for the above |
| `agent/src/updater.ts` (create) | Stateful update engine: detect command, download, verify, stage, write+spawn bat, marker handling, health heartbeat file |
| `agent/updater-template.bat` (create) | Swap/restart/rollback script; `{{PLACEHOLDER}}` substitution |
| `agent/src/index.ts` (modify) | Startup self-check + heartbeat, poll hook, post-update status reporting |
| `src/lib/db.ts`, `src/lib/db-supabase.ts` (modify) | `getAgentUpdateState()`, `requestAgentUpdate()` accessors + SQLite columns/table |
| `supabase/migrations/20260806000000_agent_self_update.sql` (create) | Postgres columns + `agent_update_events` |
| `scripts/package-for-shop.mjs` (modify) | `--publish` flag: build code/full zip, sha256, upload, write `latest.json` |
| `scripts/push-agent-update.mjs` (create) | CLI trigger (`npm run agent:push-update`) |
| `src/app/api/admin/agent-update/route.ts` (create) | GET status / POST trigger (super_admin) |
| Admin printer panel component (modify — locate via grep in Task 6) | "Print Agent" card |

---

### Task 1: Schema + DB accessors

**Files:**
- Create: `supabase/migrations/20260806000000_agent_self_update.sql`
- Modify: `src/lib/db.ts` (agent_config bootstrap + new accessors), `src/lib/db-supabase.ts`
- Test: `src/lib/db.test.ts` (append)

**Interfaces:**
- Produces (used by Tasks 5, 6):
  - `getAgentUpdateState(): Promise<AgentUpdateState>` where `AgentUpdateState = { agentVersion: string | null; agentHealthyAt: string | null; updateTargetVersion: string | null; updateStatus: string | null; updateMessage: string | null; updateStartedAt: string | null; lastEvent: { fromVersion: string | null; toVersion: string | null; status: string; message: string | null; createdAt: string } | null }`
  - `requestAgentUpdate(targetVersion: string): Promise<void>` — sets `update_target_version`, `update_status='requested'`, `update_message=null`, `update_started_at=now`, bumps `config_version`, `updated_at`.

- [ ] **Step 1: Write migration**

```sql
-- supabase/migrations/20260806000000_agent_self_update.sql
alter table agent_config
  add column if not exists agent_version         text,
  add column if not exists agent_healthy_at      timestamptz,
  add column if not exists update_target_version text,
  add column if not exists update_status         text,
  add column if not exists update_message        text,
  add column if not exists update_started_at     timestamptz;

create table if not exists agent_update_events (
  id bigserial primary key,
  from_version text,
  to_version   text,
  status       text not null,
  message      text,
  created_at   timestamptz not null default now()
);
alter table agent_update_events enable row level security;
create policy "staff read update events" on agent_update_events
  for select using (is_staff());
-- Writes come only from the service-role key (agent/CLI); no insert policy needed.
```

- [ ] **Step 2: SQLite parity in `src/lib/db.ts`**

Follow the existing column-backfill pattern at `src/lib/db.ts:253` (PRAGMA table_info + `ALTER TABLE agent_config ADD COLUMN`): extend that backfill list with `agent_version`, `agent_healthy_at`, `update_target_version`, `update_status`, `update_message`, `update_started_at` (all TEXT). Add to the `CREATE TABLE` block:

```sql
CREATE TABLE IF NOT EXISTS agent_update_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_version TEXT,
  to_version TEXT,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 3: Write failing tests** (append to `src/lib/db.test.ts`, following that file's existing setup pattern for a temp SQLite db)

```ts
describe("agent update state", () => {
  it("returns null fields before any update", async () => {
    const state = await getAgentUpdateState();
    expect(state.updateStatus).toBeNull();
    expect(state.lastEvent).toBeNull();
  });

  it("requestAgentUpdate sets requested state and bumps config_version", async () => {
    const before = await getAgentConfig();
    await requestAgentUpdate("1.2.0");
    const state = await getAgentUpdateState();
    expect(state.updateTargetVersion).toBe("1.2.0");
    expect(state.updateStatus).toBe("requested");
    expect(state.updateStartedAt).toBeTruthy();
    const after = await getAgentConfig();
    expect(after.configVersion).toBe(before.configVersion + 1);
  });
});
```

- [ ] **Step 4: Run tests, verify FAIL** — `npm run test -- src/lib/db.test.ts` → fails: `getAgentUpdateState is not a function`.

- [ ] **Step 5: Implement accessors**

In `src/lib/db.ts` (SQLite branch, mirroring `getAgentConfig` at `:981` which delegates to `db-supabase.ts` when Supabase is configured):

```ts
export type AgentUpdateState = { /* shape from Interfaces above */ };

export async function getAgentUpdateState(): Promise<AgentUpdateState> {
  if (useSupabase()) return (await import("./db-supabase")).getAgentUpdateState();
  const row = sqlite.prepare(`SELECT agent_version, agent_healthy_at, update_target_version,
    update_status, update_message, update_started_at FROM agent_config WHERE id = 1`).get() as any;
  const ev = sqlite.prepare(`SELECT from_version, to_version, status, message, created_at
    FROM agent_update_events ORDER BY id DESC LIMIT 1`).get() as any;
  return {
    agentVersion: row?.agent_version ?? null,
    agentHealthyAt: row?.agent_healthy_at ?? null,
    updateTargetVersion: row?.update_target_version ?? null,
    updateStatus: row?.update_status ?? null,
    updateMessage: row?.update_message ?? null,
    updateStartedAt: row?.update_started_at ?? null,
    lastEvent: ev ? { fromVersion: ev.from_version, toVersion: ev.to_version, status: ev.status, message: ev.message, createdAt: ev.created_at } : null
  };
}

export async function requestAgentUpdate(targetVersion: string): Promise<void> {
  if (useSupabase()) return (await import("./db-supabase")).requestAgentUpdate(targetVersion);
  const now = new Date().toISOString();
  sqlite.prepare(`UPDATE agent_config SET update_target_version = ?, update_status = 'requested',
    update_message = NULL, update_started_at = ?, config_version = config_version + 1, updated_at = ? WHERE id = 1`)
    .run(targetVersion, now, now);
}
```

(`useSupabase()` = whatever guard `getAgentConfig` already uses in that file — reuse it verbatim.) Mirror both functions in `src/lib/db-supabase.ts` using `.from("agent_config").update(...)` / `.from("agent_update_events").select(...).order("id", { ascending: false }).limit(1)`.

- [ ] **Step 6: Run tests → PASS; `npm run typecheck` → clean.**

- [ ] **Step 7: Apply migration to Supabase** via mcp supabase `apply_migration` (name `agent_self_update`) or note it in the commit message as a pending manual step if MCP unavailable.

- [ ] **Step 8: Commit** — `git commit -m "feat: schema + accessors for agent self-update state"`

---

### Task 2: Pure update helpers (`update-lib.ts`)

**Files:**
- Create: `agent/src/update-lib.ts`, Test: `agent/src/update-lib.test.ts`

**Interfaces:**
- Produces (used by Tasks 3, 4, 5 and packager):
  - `compareVersions(a: string, b: string): -1 | 0 | 1` — numeric dotted compare ("1.10.0" > "1.9.0")
  - `parseLatestJson(raw: string): LatestJson` — throws `Error` with human message on any invalid shape; `LatestJson = { version: string; kind: "code" | "full"; file: string; sha256: string; publishedAt: string }`
  - `sha256Hex(buf: Buffer | Uint8Array): string`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { compareVersions, parseLatestJson, sha256Hex } from "./update-lib";

describe("compareVersions", () => {
  it("orders numerically per segment", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("parseLatestJson", () => {
  const good = { version: "1.4.0", kind: "code", file: "agent-1.4.0.zip", sha256: "a".repeat(64), publishedAt: "2026-08-06T00:00:00Z" };
  it("accepts a valid document", () => {
    expect(parseLatestJson(JSON.stringify(good)).kind).toBe("code");
  });
  it("rejects bad kind, missing sha256, non-json", () => {
    expect(() => parseLatestJson(JSON.stringify({ ...good, kind: "delta" }))).toThrow();
    expect(() => parseLatestJson(JSON.stringify({ ...good, sha256: "short" }))).toThrow();
    expect(() => parseLatestJson("not json")).toThrow();
  });
});

describe("sha256Hex", () => {
  it("matches known vector", () => {
    expect(sha256Hex(Buffer.from("abc")))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npm run test -- agent/src/update-lib.test.ts`, module not found). If vitest's include pattern excludes `agent/**`, extend `vitest.config`/`vite.config` `test.include` to cover `agent/src/**/*.test.ts` in this step.

- [ ] **Step 3: Implement** — `compareVersions` splits on `.`, compares Number segments, missing segments = 0. `parseLatestJson` JSON.parses, checks each field type, `kind` ∈ {code, full}, `sha256` matches `/^[0-9a-f]{64}$/`, throws `new Error("latest.json invalid: <reason>")`. `sha256Hex` = `createHash("sha256").update(buf).digest("hex")` from `node:crypto`.

- [ ] **Step 4: Run → PASS. Commit** — `feat: pure helpers for agent update (version compare, latest.json, sha256)`

---

### Task 3: Publisher — `package-for-shop.mjs --publish` + `agent/version.json`

**Files:**
- Create: `agent/version.json` → `{ "version": "1.0.0" }`
- Modify: `scripts/package-for-shop.mjs`, `package.json` (script `"package:shop": "node scripts/package-for-shop.mjs"` if not present)

**Interfaces:**
- Consumes: `sha256Hex` logic (duplicate 3 lines inline with `node:crypto` — the .mjs script can't import the .ts lib; keep it inline, it's 3 lines).
- Produces: Storage objects `agent-updates/agent-<version>.zip` and `agent-updates/latest.json` (shape = `LatestJson` from Task 2). Later tasks depend on these exact names.

- [ ] **Step 1: Create `agent/version.json`** with `{ "version": "1.0.0" }`. In the existing copy step of the packager nothing changes — `agent/` is copied wholesale, so `version.json` ships automatically.

- [ ] **Step 2: Implement `--publish`** (append after the current zip step; plain code, no test framework — this script runs on the dev machine only). Logic:

```js
if (process.argv.includes("--publish")) {
  const { createClient } = await import("@supabase/supabase-js");
  const { createHash } = await import("node:crypto");
  const version = JSON.parse(await readFile(path.join(root, "agent", "version.json"), "utf8")).version;
  const supabase = createClient(config.supabaseUrl, config.supabaseKey); // reuse agent config.json creds already loaded above

  // Refuse to republish an existing version — forces a deliberate bump.
  const { data: existing } = await supabase.storage.from("agent-updates").list("", { search: `agent-${version}.zip` });
  if (existing?.some(f => f.name === `agent-${version}.zip`)) {
    console.error(`agent-${version}.zip already published — bump agent/version.json first.`);
    process.exit(1);
  }

  // code vs full: compare pinned dep versions against last published latest.json
  const { data: latestBlob } = await supabase.storage.from("agent-updates").download("latest.json");
  let lastDeps = null;
  if (latestBlob) { try { lastDeps = JSON.parse(await latestBlob.text()).deps ?? null; } catch { /* first publish */ } }
  const depsChanged = !lastDeps || AGENT_DEPS.some(d => lastDeps[d] !== pinned[d]);
  const kind = depsChanged ? "full" : "code";

  // Build update staging: full = entire engine/ contents minus config.json;
  // code = engine/agent/ minus config.json. Reuse stageDir contents already built above.
  const updStage = path.join(root, "dist-shop-package", "update-payload");
  rmSync(updStage, { recursive: true, force: true });
  if (kind === "full") {
    cpSync(engineDir, updStage, { recursive: true, filter: s => !s.endsWith("config.json") });
  } else {
    cpSync(path.join(engineDir, "agent"), path.join(updStage, "agent"), { recursive: true, filter: s => !s.endsWith("config.json") });
  }
  const updZip = path.join(root, "dist-shop-package", `agent-${version}.zip`);
  execFileSync("powershell", ["-NoProfile", "-Command",
    `Compress-Archive -Path "${updStage}\\*" -DestinationPath "${updZip}" -Force`]);

  const zipBytes = await readFile(updZip);
  const sha256 = createHash("sha256").update(zipBytes).digest("hex");

  // Zip first, latest.json LAST — a half-finished publish never advertises a missing zip.
  const up1 = await supabase.storage.from("agent-updates").upload(`agent-${version}.zip`, zipBytes, { contentType: "application/zip" });
  if (up1.error) { console.error(`upload failed: ${up1.error.message}`); process.exit(1); }
  const latest = { version, kind, file: `agent-${version}.zip`, sha256, publishedAt: new Date().toISOString(), deps: pinned };
  const up2 = await supabase.storage.from("agent-updates").upload("latest.json", Buffer.from(JSON.stringify(latest, null, 2)), { contentType: "application/json", upsert: true });
  if (up2.error) { console.error(`latest.json upload failed: ${up2.error.message}`); process.exit(1); }
  console.log(`Published ${kind} update ${version} (${(zipBytes.length / 1024).toFixed(0)} KB), sha256=${sha256}`);
}
```

Note: `latest.json` carries an extra `deps` field (pinned dep versions) so the next publish can detect changes; `parseLatestJson` ignores unknown fields — verify it does (it validates required fields only, doesn't reject extras).

- [ ] **Step 3: Create the bucket** — via supabase MCP `execute_sql`: `insert into storage.buckets (id, name, public) values ('agent-updates', 'agent-updates', false) on conflict do nothing;` (or dashboard; note in commit if manual).

- [ ] **Step 4: Verify manually** — run `node scripts/package-for-shop.mjs --publish`; confirm both objects exist in Storage (MCP or dashboard); run again unchanged → must refuse ("already published").

- [ ] **Step 5: Commit** — `feat: publish agent update artifacts to Supabase Storage`

---

### Task 4: Agent updater — download/verify/stage + updater.bat + health heartbeat

The riskiest task. All swap machinery lives here.

**Files:**
- Create: `agent/updater-template.bat`, `agent/src/updater.ts`
- Modify: `agent/src/index.ts` (self-check, heartbeat, poll hook, marker reporting), `agent/dev-tools/config.example.json` (+`"updateMode": "manual"`)
- Test: `agent/src/updater.test.ts`

**Interfaces:**
- Consumes: `compareVersions`, `parseLatestJson`, `sha256Hex` from `./update-lib`; `supabase` client + `log()` from index (passed in — no circular import).
- Produces (called from index.ts):
  - `initUpdater(deps: { supabase: SupabaseClient; log: (m: string) => void; isProcessing: () => boolean }): void`
  - `checkForUpdateCommand(): Promise<void>` — full pipeline; on success spawns bat and calls `process.exit(0)`
  - `reportPostUpdateStatus(currentVersion: string): Promise<void>` — startup: reads marker files, writes success/rolled_back + audit row
  - `writeHealthHeartbeat(version: string): Promise<void>` — writes `<shopRoot>/agent-health.txt` containing the version string
- File/path contract (shared with the bat — keep in sync):
  - `<shopRoot>` = `path.resolve(process.cwd(), "..")`
  - staged payload → `<shopRoot>/update-staging/payload/`
  - generated bat → `<shopRoot>/update-staging/run-update.bat`
  - health file → `<shopRoot>/agent-health.txt` (agent writes AFTER self-check passes, every startup)
  - rollback marker → `<shopRoot>/update-rollback.txt` (bat writes reason; agent reads+deletes+reports on startup)
  - pending marker → `<shopRoot>/update-pending.txt` (updater writes `<fromVersion> <toVersion>` before spawning bat; new agent reads it to know an update just happened, then deletes)

- [ ] **Step 1: Write `agent/updater-template.bat`**

```bat
@echo off
REM Generated by agent updater — placeholders filled at write time.
set "ROOT={{ROOT}}"
set "KIND={{KIND}}"
set "TARGET={{VERSION}}"
set "LOG=%ROOT%\update-staging\updater.log"

echo [%date% %time%] updater start kind=%KIND% target=%TARGET% >> "%LOG%"

REM 1. Wait (max 60s) for the agent's node process to release engine\ files.
set /a tries=0
:waitloop
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if errorlevel 1 goto swap
set /a tries+=1
if %tries% geq 60 (
  echo [%time%] agent never exited, aborting swap >> "%LOG%"
  echo agent process did not exit within 60s> "%ROOT%\update-rollback.txt"
  schtasks /Run /TN "SelfPrintAgent" >nul 2>nul
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitloop

:swap
del "%ROOT%\agent-health.txt" >nul 2>nul
if "%KIND%"=="full" (
  ren "%ROOT%\engine" engine.bak || goto swapfail
  xcopy "%ROOT%\update-staging\payload" "%ROOT%\engine\" /E /I /Q /Y >nul || goto restorefull
  copy /Y "%ROOT%\engine.bak\agent\config.json" "%ROOT%\engine\agent\config.json" >nul || goto restorefull
) else (
  ren "%ROOT%\engine\agent" agent.bak || goto swapfail
  xcopy "%ROOT%\update-staging\payload\agent" "%ROOT%\engine\agent\" /E /I /Q /Y >nul || goto restorecode
  copy /Y "%ROOT%\engine\agent.bak\config.json" "%ROOT%\engine\agent\config.json" >nul || goto restorecode
)

echo [%time%] swap done, restarting task >> "%LOG%"
schtasks /Run /TN "SelfPrintAgent" >nul 2>nul

REM 2. Wait up to 90s for the new agent's health heartbeat with the target version.
set /a tries=0
:healthloop
if exist "%ROOT%\agent-health.txt" (
  findstr /C:"%TARGET%" "%ROOT%\agent-health.txt" >nul && goto healthy
)
set /a tries+=1
if %tries% geq 90 goto unhealthy
timeout /t 1 /nobreak >nul
goto healthloop

:healthy
echo [%time%] new agent healthy, removing backup >> "%LOG%"
if "%KIND%"=="full" ( rmdir /S /Q "%ROOT%\engine.bak" ) else ( rmdir /S /Q "%ROOT%\engine\agent.bak" )
rmdir /S /Q "%ROOT%\update-staging\payload" >nul 2>nul
exit /b 0

:unhealthy
echo [%time%] no heartbeat in 90s, rolling back >> "%LOG%"
taskkill /IM node.exe /F >nul 2>nul
if "%KIND%"=="full" (
  rmdir /S /Q "%ROOT%\engine"
  ren "%ROOT%\engine.bak" engine
) else (
  rmdir /S /Q "%ROOT%\engine\agent"
  ren "%ROOT%\engine\agent.bak" agent
)
echo new agent failed health check within 90s> "%ROOT%\update-rollback.txt"
schtasks /Run /TN "SelfPrintAgent" >nul 2>nul
exit /b 1

:restorefull
rmdir /S /Q "%ROOT%\engine" >nul 2>nul
ren "%ROOT%\engine.bak" engine
goto swapfail2
:restorecode
rmdir /S /Q "%ROOT%\engine\agent" >nul 2>nul
ren "%ROOT%\engine\agent.bak" agent
goto swapfail2
:swapfail
echo [%time%] rename failed >> "%LOG%"
:swapfail2
echo file swap failed, restored previous version> "%ROOT%\update-rollback.txt"
schtasks /Run /TN "SelfPrintAgent" >nul 2>nul
exit /b 1
```

Known accepted limitation (single-shop PC, agent is the only node.exe): the wait loop keys on the node.exe image name. Document this in a comment.

- [ ] **Step 2: Write failing tests for the pipeline pieces** (`agent/src/updater.test.ts`). The full pipeline touches network + process — test the testable core by extracting it: `stageUpdate(zipBytes: Buffer, expectedSha: string, stagingDir: string): Promise<void>` (verify sha → throw on mismatch; extract via PowerShell `Expand-Archive` into `stagingDir/payload`) and `renderUpdaterBat(template: string, vars: { root: string; kind: "code" | "full"; version: string }): string`.

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { stageUpdate, renderUpdaterBat } from "./updater";
import { sha256Hex } from "./update-lib";

describe("stageUpdate", () => {
  it("rejects sha mismatch without extracting", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "upd-"));
    await expect(stageUpdate(Buffer.from("junk"), "0".repeat(64), dir)).rejects.toThrow(/sha256/);
    expect(existsSync(path.join(dir, "payload"))).toBe(false);
  });

  it("extracts a valid zip into payload/", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "upd-"));
    const src = mkdtempSync(path.join(tmpdir(), "src-"));
    writeFileSync(path.join(src, "hello.txt"), "hi");
    const zip = path.join(dir, "p.zip");
    execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path "${src}\\*" -DestinationPath "${zip}"`]);
    const bytes = require("node:fs").readFileSync(zip);
    await stageUpdate(bytes, sha256Hex(bytes), dir);
    expect(existsSync(path.join(dir, "payload", "hello.txt"))).toBe(true);
  });
});

describe("renderUpdaterBat", () => {
  it("substitutes all placeholders", () => {
    const out = renderUpdaterBat("x {{ROOT}} {{KIND}} {{VERSION}}", { root: "C:\\shop", kind: "code", version: "1.1.0" });
    expect(out).toBe("x C:\\shop code 1.1.0");
    expect(out).not.toContain("{{");
  });
});
```

- [ ] **Step 3: Run → FAIL. Then implement `agent/src/updater.ts`:**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compareVersions, parseLatestJson, sha256Hex } from "./update-lib";

const shopRoot = path.resolve(process.cwd(), "..");
const stagingDir = path.join(shopRoot, "update-staging");
const agentDir = path.join(process.cwd(), "agent");

let deps: { supabase: SupabaseClient; log: (m: string) => void; isProcessing: () => boolean };
let updating = false;

export function initUpdater(d: typeof deps) { deps = d; }

export function currentVersion(): string {
  return JSON.parse(readFileSync(path.join(agentDir, "version.json"), "utf8")).version;
}

export async function stageUpdate(zipBytes: Buffer, expectedSha: string, dir: string): Promise<void> {
  const actual = sha256Hex(zipBytes);
  if (actual !== expectedSha) throw new Error(`sha256 mismatch: expected ${expectedSha}, got ${actual}`);
  const zipPath = path.join(dir, "update.zip");
  const payload = path.join(dir, "payload");
  await fs.rm(payload, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(zipPath, zipBytes);
  execFileSync("powershell", ["-NoProfile", "-Command",
    `Expand-Archive -Path "${zipPath}" -DestinationPath "${payload}" -Force`]);
}

export function renderUpdaterBat(template: string, vars: { root: string; kind: "code" | "full"; version: string }): string {
  return template.replaceAll("{{ROOT}}", vars.root).replaceAll("{{KIND}}", vars.kind).replaceAll("{{VERSION}}", vars.version);
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

export async function checkForUpdateCommand(): Promise<void> {
  if (updating) return;
  const mine = currentVersion();
  const { data, error } = await deps.supabase.from("agent_config")
    .select("update_target_version, update_status").eq("id", 1).single() as any;
  if (error || !data?.update_target_version) return;
  if (data.update_status !== "requested") return;
  if (compareVersions(data.update_target_version, mine) === 0) { await setStatus("success", "already on this version"); return; }
  if (deps.isProcessing()) { deps.log("Update requested but a job is printing — retrying next poll."); return; }

  updating = true;
  const target = data.update_target_version as string;
  try {
    deps.log(`Update ${mine} -> ${target}: downloading manifest...`);
    await setStatus("downloading");
    const { data: manifestBlob, error: mErr } = await deps.supabase.storage.from("agent-updates").download("latest.json");
    if (mErr || !manifestBlob) throw new Error(`latest.json download failed: ${mErr?.message}`);
    const latest = parseLatestJson(await manifestBlob.text());
    if (latest.version !== target) throw new Error(`latest.json has ${latest.version}, target is ${target}`);

    const { data: zipBlob, error: zErr } = await deps.supabase.storage.from("agent-updates").download(latest.file);
    if (zErr || !zipBlob) throw new Error(`${latest.file} download failed: ${zErr?.message}`);
    await stageUpdate(Buffer.from(await zipBlob.arrayBuffer()), latest.sha256, stagingDir);

    const template = await fs.readFile(path.join(agentDir, "updater-template.bat"), "utf8");
    const bat = renderUpdaterBat(template, { root: shopRoot, kind: latest.kind, version: target });
    const batPath = path.join(stagingDir, "run-update.bat");
    await fs.writeFile(batPath, bat);
    await fs.writeFile(path.join(shopRoot, "update-pending.txt"), `${mine} ${target}`);

    await setStatus("swapping");
    deps.log(`Update staged; handing off to updater.bat and exiting.`);
    spawn("cmd.exe", ["/c", batPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    setTimeout(() => process.exit(0), 500); // give the spawn a beat to detach
  } catch (err) {
    updating = false;
    const msg = err instanceof Error ? err.message : String(err);
    deps.log(`Update failed (old version keeps running): ${msg}`);
    await setStatus("failed", msg);
    await audit(mine, target, "failed", msg);
  }
}

// Startup: report the outcome of a swap that happened while we were down.
export async function reportPostUpdateStatus(): Promise<void> {
  const mine = currentVersion();
  const rollbackMarker = path.join(shopRoot, "update-rollback.txt");
  const pendingMarker = path.join(shopRoot, "update-pending.txt");
  if (existsSync(rollbackMarker)) {
    const reason = (await fs.readFile(rollbackMarker, "utf8")).trim();
    const pending = existsSync(pendingMarker) ? (await fs.readFile(pendingMarker, "utf8")).trim().split(" ") : [null, null];
    await setStatus("rolled_back", reason);
    await audit(pending[0], pending[1], "rolled_back", reason);
    await fs.rm(rollbackMarker, { force: true });
    await fs.rm(pendingMarker, { force: true });
    deps.log(`Previous update rolled back: ${reason}`);
    return;
  }
  if (existsSync(pendingMarker)) {
    const [from, to] = (await fs.readFile(pendingMarker, "utf8")).trim().split(" ");
    if (to === mine) { await setStatus("success"); await audit(from, to, "success"); deps.log(`Update to ${mine} succeeded.`); }
    await fs.rm(pendingMarker, { force: true });
  }
  // Always report the running version + clear stale in-flight status from a crash.
  await (deps.supabase.from("agent_config") as any)
    .update({ agent_version: mine, updated_at: new Date().toISOString() }).eq("id", 1);
}

export async function writeHealthHeartbeat(): Promise<void> {
  await fs.writeFile(path.join(shopRoot, "agent-health.txt"), currentVersion());
  await (deps.supabase.from("agent_config") as any)
    .update({ agent_healthy_at: new Date().toISOString(), agent_version: currentVersion() }).eq("id", 1);
}
```

- [ ] **Step 4: Wire into `agent/src/index.ts`:**
  - `AgentConfig` type + `loadConfig` gain `updateMode?: string` (default `"manual"`); at the top of `main()`: `if (config.updateMode && config.updateMode !== "manual") { log(\`updateMode "${config.updateMode}" is not implemented — use "manual".\`); process.exit(1); }`
  - After `supabase` client creation: `initUpdater({ supabase, log, isProcessing: () => isProcessing });`
  - **Self-check before heartbeat** (new function, called in `main()` after `checkPrinterConfig()`):

```ts
async function startupSelfCheckAndHeartbeat() {
  try {
    const lib = await PDFiumLibrary.init();          // 1. pdfium wasm loads
    lib.destroy?.();
    await sharp(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64")).png().toBuffer();                    // 2. sharp native binding works
    const printers = await listWindowsPrinters();     // 3. >=1 printer
    if (!printers.length) throw new Error("no printers enumerated");
    await reportPostUpdateStatus();                   // 4. supabase reachable (this write proves it)
    await writeHealthHeartbeat();
    log(`Self-check passed — agent v${currentVersion()} healthy.`);
  } catch (err) {
    log(`SELF-CHECK FAILED (no heartbeat written): ${err instanceof Error ? err.message : String(err)}`);
    // Do NOT write the heartbeat: if this start follows a swap, updater.bat will roll back.
  }
}
```

  - In the existing `checkPrinterConfig` interval (`agent/src/index.ts:183`): add `checkForUpdateCommand().catch(() => {})` alongside it — same cadence, no new timer. Also call it once after `checkPrinterConfig()` in the SUBSCRIBED handler so a queued command applies promptly on startup.
  - Add `"updateMode": "manual"` to `agent/dev-tools/config.example.json`.

- [ ] **Step 5: Run tests + typecheck → PASS.** Note: `npm run typecheck` covers `agent/` only if `tsconfig.json` includes it — verify, and if excluded run `npx tsc --noEmit -p tsconfig.json` plus a targeted `npx tsc --noEmit agent/src/updater.ts` sanity pass.

- [ ] **Step 6: Integration smoke on THIS dev machine** (manual, scripted in scratchpad — not committed): build a fake `<root>` with `engine/agent/{version.json,config.json}`, run `renderUpdaterBat` output with a fake payload, verify: code-kind swap preserves config.json; deleting the health file → rollback restores `agent.bak`. This is the "rollback has actually run once" requirement from the spec, minus the real shop PC.

- [ ] **Step 7: Commit** — `feat: agent self-update pipeline with health-gated rollback`

---

### Task 5: Triggers — API route + CLI

**Files:**
- Create: `src/app/api/admin/agent-update/route.ts`, `scripts/push-agent-update.mjs`
- Modify: `package.json` (add `"agent:push-update": "node scripts/push-agent-update.mjs"`)

**Interfaces:**
- Consumes: `getAgentUpdateState`, `requestAgentUpdate` (Task 1); `requireStaff` from `@/lib/security`; Storage `latest.json` (Task 3 shape).
- Produces: `GET /api/admin/agent-update` → `{ state: AgentUpdateState, latest: { version, kind, publishedAt, sizeKb } | null }`; `POST` `{}` → `{ success: true, targetVersion }`.

- [ ] **Step 1: Implement route** (no route-level test harness exists in this repo — routes are thin; logic already tested in Task 1):

```ts
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { getAgentUpdateState, requestAgentUpdate } from "@/lib/db";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function fetchLatest() {
  try {
    const { data } = await serviceClient().storage.from("agent-updates").download("latest.json");
    if (!data) return null;
    const j = JSON.parse(await data.text());
    return { version: j.version, kind: j.kind, publishedAt: j.publishedAt };
  } catch { return null; }
}

export async function GET() {
  const staff = await requireStaff();
  if (!staff || staff.role !== "super_admin") return NextResponse.json({ error: "Super admin required" }, { status: 401 });
  const [state, latest] = await Promise.all([getAgentUpdateState(), fetchLatest()]);
  return NextResponse.json({ state, latest });
}

export async function POST() {
  const staff = await requireStaff();
  if (!staff || staff.role !== "super_admin") return NextResponse.json({ error: "Super admin required" }, { status: 401 });
  const [state, latest] = await Promise.all([getAgentUpdateState(), fetchLatest()]);
  if (!latest) return NextResponse.json({ error: "No published update found" }, { status: 400 });
  if (["requested", "downloading", "swapping"].includes(state.updateStatus ?? "")) {
    return NextResponse.json({ error: `Update already in progress (${state.updateStatus})` }, { status: 409 });
  }
  if (state.agentVersion === latest.version) {
    return NextResponse.json({ error: `Agent already on ${latest.version}` }, { status: 400 });
  }
  await requestAgentUpdate(latest.version);
  return NextResponse.json({ success: true, targetVersion: latest.version });
}
```

- [ ] **Step 2: CLI `scripts/push-agent-update.mjs`** — reads `agent/config.json` creds (same as packager), downloads `latest.json`, prints current `agent_config.agent_version` vs latest, refuses if in-flight, then performs the same UPDATE as `requestAgentUpdate` via the service client, logs "Requested update to <v> — agent will pick it up within ~5s of its next poll."

- [ ] **Step 3: Verify** — `npm run typecheck`; hit GET as super_admin locally (or `curl` with dev session) and confirm shape; run CLI against dev Supabase.

- [ ] **Step 4: Commit** — `feat: agent update triggers (admin API + CLI)`

---

### Task 6: Admin dashboard card

**Files:**
- Modify: the printer/agent settings panel component — locate with `grep -rn "Printer" src/components/admin` (the panel that already shows `agent_printers`/printer pickers; likely surfaced from `ManageMenu`/`AdminDashboard`). Add a `PrintAgentCard`.
- Create: `src/components/admin/PrintAgentCard.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/admin/agent-update` (Task 5 shapes). SWR is already a dependency — follow the data-fetch pattern used by the surrounding admin components (check how the printer panel fetches before writing).

- [ ] **Step 1: Implement `PrintAgentCard`** matching the spec mock:
  - Running row: `state.agentVersion ?? "unknown"` + healthy badge if `agentHealthyAt` within 2× printer heartbeat (5 min), else "offline" in muted red, with relative time.
  - Available row: from `latest`; hidden if `latest` is null or equals `agentVersion`.
  - Button "Install update": disabled while `updateStatus` ∈ requested/downloading/swapping (show that status as label, e.g. "Installing… (swapping)"); POSTs, then revalidates on a 5s SWR refresh while in-flight.
  - Last-update line from `state.lastEvent`; if `lastEvent.status` is `failed`/`rolled_back`, render message in red until a later success.
  - Card only renders for super_admin — gate on the same role signal the surrounding page already has (check how it hides super_admin-only controls, e.g. staff management, and copy that).
- [ ] **Step 2: Verify in browser** — run dev server, log in as super_admin, confirm: card renders, button fires POST (watch network tab), non-super_admin sees no card, GET 401s.
- [ ] **Step 3: `npm run typecheck && npm run test` → clean. Commit** — `feat: print agent update card in admin dashboard`

---

### Task 7: Docs + end-to-end on real package

**Files:**
- Modify: `CLAUDE.md` + `AGENTS.md` (commands: `--publish`, `agent:push-update`; schema: `agent_update_events` + new `agent_config` columns), `PROJECT.md` (same), `README.md` (developer "shipping an agent update" section), `docs/CLIENT_PC_SETUP.md` (note: updates are automatic, nothing for the client)

- [ ] **Step 1: Write docs** — a "Shipping an agent update" runbook: bump `agent/version.json` → `npm run package:shop -- --publish` → press Install in dashboard (or `npm run agent:push-update`) → watch card go requested → swapping → success; what failed/rolled_back mean and where to look (`update-staging/updater.log`, `agent.log`).
- [ ] **Step 2: End-to-end test with the real package** (manual, on dev machine standing in for the shop PC):
  1. `npm run package:shop`, unzip to a scratch folder, run agent from `engine/` (`npx tsx agent/src/index.ts` with a real config.json).
  2. Bump version.json to 1.0.1, `--publish` (code-only expected), trigger via CLI → verify swap, `success` status, audit row, config.json preserved.
  3. Publish a deliberately broken 1.0.2 (e.g. temporarily corrupt `agent/src/index.ts` syntax before packaging) → trigger → verify rollback fires, agent back on 1.0.1, status `rolled_back` with reason, card shows red.
  4. Restore, publish clean 1.0.2, verify recovery path.
- [ ] **Step 3: Commit** — `docs: agent self-update runbook + schema docs`

---

## Self-review notes

- Spec coverage: schema ✔ (T1), publish/bucket/latest-last/refuse-republish ✔ (T3), download/sha/stage/detached-bat/exit ✔ (T4), health check 4 points + heartbeat ✔ (T4 Step 4), rollback + markers + status reporting ✔ (T4), busy-printing deferral ✔ (T4 `isProcessing`), mode switch reserved ✔ (T4 Step 4), dashboard + CLI triggers ✔ (T5), card + red failure ✔ (T6), audit table ✔ (T1/T4), tests incl. deliberate-broken-build ✔ (T4 Step 6, T7 Step 2).
- Known accepted limitations (documented in code): bat waits on/kills `node.exe` by image name (agent is the only node process on the shop PC); dev-machine runs compute `shopRoot` above the repo, so swaps only ever execute from a packaged layout (guard: `checkForUpdateCommand` is reached only when a `requested` row exists, which a dev DB won't have pointed at a dev agent unless deliberately testing).
