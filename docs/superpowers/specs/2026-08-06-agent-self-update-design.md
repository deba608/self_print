# Agent Self-Update — Design

Date: 2026-08-06
Status: Approved (brainstorm complete)

## Problem

The shop PC runs the print agent from a frozen zip snapshot (`scripts/package-for-shop.mjs` → `selfprint-agent.zip`). Changes to `agent/src/index.ts`, `print-image.ps1`, the `.bat`/`.vbs` launchers, or agent dependencies (sharp, pdfium) never reach the client without re-shipping a zip and walking a non-technical client through re-installing. The web app, database, and pricing update automatically (shared backend); the agent does not.

## Goal

Update the agent on the shop PC with zero client action. Developer publishes a release, presses a button in the admin dashboard (or runs a CLI command), agent updates itself safely, and rolls back automatically if the new version is broken.

## Constraints and decisions (from brainstorm)

- **One shop PC.** No staged rollout, per-shop pinning, or fleet dashboard.
- **Manual trigger** (`updateMode: "manual"`, default). `"auto"` and `"window"` are reserved config values that throw "not implemented" at startup — the switch exists for later, but cannot silently half-work.
- **Two triggers, one mechanism:** admin dashboard card (super_admin only) and `npm run agent:push-update` CLI. Both write the same `agent_config` columns.
- **Failure reporting:** dashboard card + permanent `agent_update_events` audit table. No push/email/Telegram alert (deferred until a customer-facing notify channel exists).
- **Two payload kinds:** code-only (~100 KB) when pinned dep versions are unchanged since the last published release; full (with `node_modules`, ~100 MB) when a dep changed. Never `npm install` on the shop PC — no build tools, flaky internet.
- **Health proof before backup deletion:** startup self-check (PDFium loads, sharp native binding works, ≥1 printer enumerated, Supabase reachable) → heartbeat write. Not merely "process alive".
- **No client-facing `UPDATE-NOW.bat`.** The agent's Supabase connection is the only update channel. If the PC can't reach Supabase it can't print either, so the update is not the priority.
- **`config.json` excluded from every update payload** and explicitly preserved across swaps — it holds shop-specific printer settings and the service-role key.

## Architecture

| Piece | Responsibility | Depends on |
|---|---|---|
| `agent/version.json` | Single source of truth for the running agent version | nothing |
| `scripts/package-for-shop.mjs` (extended) | Build + publish update artifacts to Supabase Storage (`--publish` flag) | package-lock.json, Supabase Storage |
| `agent/src/updater.ts` | Detect command, download, verify, stage, hand off | Supabase client, fs |
| `agent/updater-template.bat` | Swap files, restart scheduled task, roll back on failed health check | nothing (pure Windows batch) |
| Admin card + `POST /api/admin/agent/update` | Trigger + status display | Supabase |

Core trick: **the agent never overwrites its own files** (Windows locks loaded binaries). It stages the new version, spawns a detached batch script, and exits. The batch script — the only thing left running — performs the swap.

## Storage and publish step

Bucket `agent-updates`, **private**. The agent already holds the service-role key, so it downloads directly; no public exposure of agent code.

`npm run package:shop -- --publish` = current build, plus:

1. Read `agent/version.json`. **Refuse to publish if that version already exists in Storage** — forces a deliberate version bump.
2. Compare pinned dep versions (`@supabase/supabase-js`, `sharp`, `@hyzyla/pdfium`, `tsx` from `package-lock.json`) against the last published `latest.json`:
   - unchanged → **code-only** zip: `agent/` folder minus `config.json`, minus logs
   - changed → **full** zip: `agent/` + minimal `node_modules` + `package.json`/`package-lock.json`
3. sha256 the zip.
4. Upload `agent-<version>.zip` first, then overwrite `latest.json` **last** — a half-finished publish never advertises a zip that isn't there.

`latest.json`:

```json
{
  "version": "1.4.0",
  "kind": "code",            // "code" | "full"
  "file": "agent-1.4.0.zip",
  "sha256": "…",
  "publishedAt": "2026-08-06T…"
}
```

The onboarding zip (`selfprint-agent.zip`) is unchanged in client experience; it now carries `version.json` and the updater code.

## Update flow

Trigger (dashboard button or CLI) writes to `agent_config`:

```
update_target_version = '1.4.0'
update_status         = 'requested'
update_started_at     = now()
```

The agent's existing `agent_config` poll (`checkPrinterConfig()` cadence) additionally reads these columns — **no new timer**.

```
agent sees update_target_version ≠ version.json version
        │
        ├─ isProcessing (job printing)? → wait, re-check next poll
        ├─ fetch latest.json, confirm it matches target version
        ├─ download agent-<v>.zip to agent-temp/ (service-role)   ──┐
        ├─ verify sha256                                            │ any failure →
        ├─ extract to agent-temp/staged/                            │ update_status='failed',
        │                                                           │ update_message=reason,
        ├─ update_status='swapping'                                 │ log, insert audit row,
        ├─ write updater.bat from template (paths + kind baked in)  │ KEEP RUNNING old version
        ├─ spawn updater.bat DETACHED                            ◄──┘
        └─ exit(0)

updater.bat (only process left):
        ├─ wait for agent's node process to exit (max 60s)
        ├─ kind=full:  rename engine/ → engine.bak/  (rename = near-atomic)
        │              copy staged/ → engine/
        │  kind=code:  rename engine/agent/ → engine.bak-agent/
        │              copy staged/agent/ → engine/agent/    (node_modules untouched)
        ├─ copy old config.json back into engine/agent/config.json
        ├─ schtasks /Run /TN "SelfPrintAgent"
        ├─ poll for healthy heartbeat file/flag, up to 90s
        │     ├─ healthy → delete backup, exit
        │     └─ timeout → delete new engine (or agent/), rename backup back,
        │                  schtasks /Run again, leave marker file for agent
        └─ exit
```

New agent on startup, seeing it just started post-swap: writes `update_status='success'` (or, after a rollback, the restored old agent finds the marker file and writes `update_status='rolled_back'` + reason), inserts an `agent_update_events` row either way.

Invariant: **every failure branch ends with the old version printing.** Worst case equals today's status quo (shop on a stale agent).

## Health check and heartbeat

New agent at startup, before declaring itself healthy:

1. `PDFiumLibrary.init()` — WASM binary loads
2. `sharp(1×1 buffer).png().toBuffer()` — native binding works on this CPU/arch
3. `listWindowsPrinters()` returns ≥1 printer
4. Supabase reachable (the `agent_config` read doubles as this)

All pass → write `agent_version` + `agent_healthy_at` to `agent_config` **and** touch a local heartbeat flag that `updater.bat` watches (local file, so the health signal doesn't depend on batch-script-to-Supabase plumbing). Any check fails → log reason, no heartbeat, rollback fires.

No paper used. This catches the realistic post-swap failure: a native binary that won't load on that machine.

## Schema

```sql
alter table agent_config
  add column agent_version         text,
  add column agent_healthy_at      timestamptz,
  add column update_target_version text,
  add column update_status         text,   -- requested|downloading|swapping|success|failed|rolled_back
  add column update_message        text,
  add column update_started_at     timestamptz;

create table agent_update_events (
  id bigserial primary key,
  from_version text,
  to_version   text,
  status       text not null,
  message      text,
  created_at   timestamptz not null default now()
);
```

Separate events table because `print_events.job_id` is a cascade FK to `jobs` — update events have no job. Audit trail survives `agent_config` being overwritten by each subsequent update. Mirror the columns in the SQLite schema (`src/lib/db.ts`) for local dev parity, plus a Supabase migration file.

## Admin UI

One card on the existing printer/agent settings surface, super_admin only:

```
Print Agent
  Running    v1.3.0 · healthy · 12s ago     (from agent_version / agent_healthy_at)
  Available  v1.4.0 (code-only, 98 KB)      (from latest.json via server route)
  [ Install update ]

  Last update: 1.2.0 → 1.3.0 · success · Aug 4   (from agent_update_events)
```

- Button disabled while `update_status` is in flight (`requested`/`downloading`/`swapping`).
- Last attempt `rolled_back`/`failed` → reason shown in red until the next success.
- `POST /api/admin/agent/update` validates super_admin, validates target version exists in Storage, writes the trigger columns.
- `npm run agent:push-update` (script in `scripts/`) does the same writes via service-role key.

## Error handling summary

| Failure | Outcome |
|---|---|
| latest.json unreachable / malformed | log, status=`failed`, old agent keeps running |
| sha256 mismatch | delete download, status=`failed`, keep running |
| download dies mid-transfer | status=`failed`, keep running |
| job printing when command arrives | wait; retry next poll |
| agent process won't exit within 60s | updater aborts swap, restarts task, marker → `failed` |
| updater killed mid-copy | backup still on disk; next SETUP/start recovery: agent detects marker/backup and reports; manual recovery = restore backup (documented) |
| new agent fails health check / never heartbeats | automatic rollback, status=`rolled_back` + reason |
| half-finished publish | impossible to advertise: latest.json uploads last |

## Testing

- **Unit:** latest.json parsing, version comparison, sha256 verification, code-only vs full decision in packager, config.json exclusion/preservation.
- **Integration (temp-dir simulated engine/):** corrupt zip, sha mismatch, network death mid-download, locked file (agent still running), updater killed mid-copy, new agent never heartbeats → each scenario must end with a working `engine/`.
- **Manual, once, on a shop-like PC:** full update, code-only update, and a **deliberately broken build** to watch rollback fire for real. If rollback has never run for real, it doesn't work.

## Out of scope

Staged rollout, per-shop version pinning, fleet dashboard, push/email/Telegram alerts, client-facing `UPDATE-NOW.bat`, `auto`/`window` update modes (config values reserved, unimplemented), downgrade-to-arbitrary-version.
