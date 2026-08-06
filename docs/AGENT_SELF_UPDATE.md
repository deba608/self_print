# Agent Self-Update

Zero-touch updates for the shop PC print agent. Once the agent is installed via
`SETUP.bat`, all future updates are pushed from the admin dashboard — no one
needs to touch the shop PC again.

---

## How It Works (overview)

```
Developer machine                   Supabase                     Shop PC
─────────────────                   ────────                     ───────
npm run package:shop -- --publish
  → uploads agent-1.0.1.zip  ──►  Storage bucket: agent-updates
  → writes latest.json        ──►  (agent polls or Realtime push)  ──►  agent downloads zip
                                                                          verifies SHA-256
Admin dashboard → Install button                                          writes run-update.bat
  → POST /api/admin/agent-update ──► agent_config.update_status          exits process
                                     = 'requested'                         │
                                          ▲                               Windows restarts agent
                                          │                               new agent hands off to
                                     agent writes back:                   SelfPrintUpdater task
                                     'downloading' → 'swapping'           swaps files
                                     → 'completed'                        new agent boots
                                                                          writes heartbeat ──►
```

The admin dashboard never touches the shop PC directly. It only writes one
database row. The agent — already running on the shop PC — polls that row,
pulls the zip from Supabase Storage over regular HTTPS, and applies the
update to its own files.

---

## One-Time Setup (per project)

Before the first publish:

1. **Apply the migration**
   Run `supabase/migrations/20260806000000_agent_self_update.sql` against your
   Supabase project. It adds the self-update columns to `agent_config` and
   creates the `agent_update_events` audit table.

   Via the Supabase dashboard: SQL Editor → paste and run the file.
   Via CLI: `supabase db push` (if you have the Supabase CLI set up).

2. **Create the Storage bucket**
   Supabase dashboard → Storage → New bucket → name: `agent-updates` →
   **Private** (not public). The publish script does not create it.

3. **Confirm `updateMode`**
   `agent/config.json` must have `"updateMode": "manual"` (the only implemented
   mode). The agent refuses to start if this is set to anything else.

---

## Publishing a New Version

### 1. Bump the version

Edit `agent/version.json`:
```json
{ "version": "1.0.1" }
```

Must be a dotted numeric string strictly greater than what is already
published. The publish script and the agent both enforce this — republishing
the same version or going backwards is refused.

### 2. Run the publish command

```powershell
npm run package:shop -- --publish
```

What this does:
- Builds a minimal agent zip (only the deps the agent actually uses —
  `@supabase/supabase-js`, `sharp`, `@hyzyla/pdfium`, `tsx` — not the full
  Next.js node_modules)
- Decides the payload **kind**:
  - `code` — only `agent/` folder changed (scripts + src), node_modules
    identical → small zip (~100 KB)
  - `full` — a runtime dependency version changed → includes entire
    `engine/node_modules` (~100 MB)
- Strips `agent/config.json` from the payload (shop credentials never travel
  in an update)
- Uploads `agent-1.0.1.zip` to the `agent-updates` bucket
- Writes `latest.json` last (so a half-finished upload never advertises a
  missing file)
- Deletes all previous `agent-*.zip` files from the bucket (only the current
  version is kept)

### 3. Trigger the install

**From the admin dashboard** (recommended):
- Log in as super_admin
- The "Update" button appears in the topbar navbar when a new version is
  detected (the agent's running version differs from `latest.json`)
- Click it → popup shows running version, available version, and an
  **Install** button
- Click Install → done

**From the command line**:
```powershell
npm run agent:push-update
```

Both write the same `agent_config` row. The agent picks it up via its
Supabase Realtime subscription (near-instant) or within 30 seconds on the
fallback poll.

### 4. Watch progress

The topbar badge polls every 5 seconds while an update is in flight:

| Status | Meaning |
|---|---|
| `requested` | Command written to DB, agent hasn't picked it up yet |
| `downloading` | Agent is downloading the zip from Storage |
| `swapping` | Agent has exited, SelfPrintUpdater BAT is swapping files |
| `completed` | New version running and healthy |
| `failed` | Aborted before swap — old version still running |
| `rolled_back` | Swap ran but new version failed health check — old version restored |

A job that is mid-print defers the update to the next 30s poll — updates
never interrupt a running print.

---

## What Happens on the Shop PC

### Step-by-step

1. Agent reads `update_status = 'requested'` from `agent_config`
2. Downloads `latest.json` → verifies target version > running version
3. Downloads the zip → verifies SHA-256 against `latest.json`
4. Sets status `downloading` → `swapping`
5. Writes `update-pending.txt` (crash-recovery marker)
6. Writes `run-update.bat` (SelfPrintUpdater task script with baked-in paths)
7. **Exits** — Windows Scheduled Task "SelfPrintAgent" auto-restarts it

8. New agent boot detects `update-pending.txt` → launches
   **SelfPrintUpdater** task → exits again (hands off to the separate task)

9. **SelfPrintUpdater BAT** (runs outside the agent process):
   ```
   engine/           ← current live agent
   engine.bak/       ← backup (renamed from engine before swap)
   update-extract/   ← freshly unzipped new version
   ```
   - Renames `engine → engine.bak` (5-attempt retry loop for Windows file locking)
   - For `code` update: copies new `agent/` into existing `engine/`
   - For `full` update: renames `update-extract → engine`
   - Starts SelfPrintAgent scheduled task
   - **Waits up to 3 minutes** for `agent-health.txt` to be updated

10. New agent boots, runs startup self-check (PDFium, sharp, printer enumeration,
    Supabase reachability), writes `agent-health.txt`
11. BAT sees fresh heartbeat → deletes `engine.bak`, writes status `completed`

### Rollback

If the new agent does not write a heartbeat within 3 minutes:

- BAT writes `update-failed.txt`
- Deletes failed `engine/`, renames `engine.bak → engine`
- Starts old SelfPrintAgent
- Old agent boots, reads `update-rollback.txt` → sets DB status `rolled_back`
  with reason string

Both `failed` and `rolled_back` leave a working agent running. The topbar
badge turns red and shows the reason. You can retry from the dashboard
immediately.

---

## Troubleshooting

### Dashboard shows "Updating…" forever

The update is stuck in `requested` or `downloading`. Most common causes:

- **Agent not running** — check Windows Task Scheduler on the shop PC for
  "SelfPrintAgent". If it's not running, double-click SETUP.bat again.
- **No internet on shop PC** — agent can't reach Supabase Storage.
- **Stale stuck status** — the API auto-resets in-flight status older than 30
  minutes. Or reset manually in Supabase SQL editor:
  ```sql
  UPDATE agent_config
  SET update_status = null, update_target_version = null,
      update_started_at = null, update_message = null
  WHERE id = 1;
  ```

### Status shows `failed`

The agent aborted before handing off to the updater BAT. The old version is
still running. Check in order:

1. `engine/agent/agent.log` — look for "SELF-CHECK FAILED" or SHA mismatch errors
2. Confirm `latest.json` in the `agent-updates` bucket is valid JSON with the
   right version

### Status shows `rolled_back`

The swap ran but the new version failed the health check. Check:

1. `update-staging/updater.log` on the shop PC — the BAT's own trace
2. `engine/agent/agent.log` — startup errors from the new version
3. If `updater.log` says "ROLLBACK FAILED", `engine.bak` is still present —
   rename it manually to `engine`

### Internet drops during update

| When | Effect |
|---|---|
| Before download starts | Agent retries on next poll — no harm |
| Mid-download | Download fails → status `failed` → retry from dashboard |
| After download, zip on disk | Swap runs fully offline (just file operations) — OK |
| After swap, before heartbeat | New agent can't reach Supabase → no heartbeat → rollback |
| After heartbeat written | Done — status written when connection recovers |

---

## Files on the Shop PC

```
<shop-root>/                     ← where selfprint-agent.zip was extracted
├── engine/                      ← live agent (agent/ + node_modules + package.json)
│   └── agent/
│       ├── agent.log            ← agent runtime log (rotates at 5 MB → agent.log.old)
│       ├── agent-health.txt     ← heartbeat timestamp (updated every 30s)
│       ├── config.json          ← shop credentials (never replaced by updates)
│       ├── src/                 ← agent source
│       └── version.json         ← running version number
├── engine.bak/                  ← previous version (present during swap, deleted on success)
├── update-staging/
│   ├── update.zip               ← downloaded payload (deleted after extract)
│   ├── update-extract/          ← unzipped payload (deleted after swap)
│   └── updater.log              ← SelfPrintUpdater BAT trace
├── update-pending.txt           ← written pre-swap, consumed by next agent boot
├── update-rollback.txt          ← written by BAT on rollback, consumed by agent
├── update-failed.txt            ← written by BAT on failure, consumed by agent
└── agent-health.txt             ← same as engine/agent/agent-health.txt (symlink target)
```

---

## Developer Notes

### Running on a dev machine

On your own PC (not a shop PC), run the agent directly:
```powershell
npm run agent
```

Do NOT run `SETUP.bat` on a dev machine — it installs real Windows Scheduled
Tasks. The updater guard (`IS_ENGINE_CWD` check in `agent/src/updater.ts`)
blocks the self-update logic from firing when the working directory is the
repo root rather than `engine/`.

For a persistent dev agent (survives terminal close), use PM2:
```powershell
npm install -g pm2
pm2 start "npm run agent" --name selfprint-agent --cwd "C:\path\to\Selfprint"
pm2 save && pm2 startup
```

### Adding the update migration to a fresh Supabase project

```sql
-- Run this in Supabase SQL editor (or via supabase db push)
-- File: supabase/migrations/20260806000000_agent_self_update.sql
```

See the migration file for the exact SQL — it adds columns to `agent_config`
and creates the `agent_update_events` table.

### Version number rules

- Format: dotted numeric, e.g. `1.0.0`, `1.2.3`, `2.0.0`
- Must be strictly greater than currently published version
- Cannot republish an existing version (bucket check blocks it)
- Agent refuses to install a version ≤ its running version (downgrade guard)
