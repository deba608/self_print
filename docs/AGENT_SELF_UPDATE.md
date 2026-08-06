# Agent Self-Update

Zero-touch updates for the shop PC print agent. Once the agent is installed
via `SETUP.bat`, all future versions are pushed from the admin dashboard —
nobody needs to touch the shop PC again.

---

## How It Works (overview)

```
Developer machine                   Supabase                     Shop PC (Windows)
─────────────────                   ────────                     ─────────────────
npm run package:shop -- --publish
  → uploads agent-1.0.1.zip  ──►  Storage: agent-updates/
  → writes latest.json        ──►

Admin dashboard → Install button
  → POST /api/admin/agent-update ──► agent_config row:
                                      update_status = 'requested'
                                      update_target = '1.0.1'
                                                          │
                                                          │  Realtime push (~1s)
                                                          │  or 30s poll fallback
                                                          ▼
                                                     Agent sees 'requested'
                                                     downloads zip from Storage
                                                     verifies SHA-256
                                                     writes run-update.bat
                                                     exits process
                                                          │
                                                     Windows restarts agent
                                                          │
                                                     new boot hands off to
                                                     SelfPrintUpdater task
                                                     swaps files on disk
                                                          │
                                                     new agent starts
                                                     runs self-check
                                                     writes heartbeat ──► agent_config:
                                                                           update_status = 'completed'
                                                                           agent_version = '1.0.1'
```

The admin dashboard never touches the shop PC directly. It writes one DB row.
The agent (always running on the shop PC) polls that row, pulls the zip from
Supabase Storage over HTTPS, and applies the update itself.

---

## One-Time Setup (per Supabase project)

Do this once before the first publish. You only need to do it again if you
create a new Supabase project.

### Step 1 — Apply the database migration

The migration adds self-update columns to `agent_config` and creates the
`agent_update_events` audit table.

**Via Supabase dashboard (no CLI needed):**
1. Go to your Supabase project → **SQL Editor** (left sidebar).
2. Open `supabase/migrations/20260806000000_agent_self_update.sql` from this
   repo in a text editor.
3. Paste the entire contents into the SQL Editor.
4. Click **Run**.
5. You should see "Success. No rows returned." — that means it worked.

**Via Supabase CLI:**
```powershell
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

### Step 2 — Create the Storage bucket

1. In Supabase → **Storage** (left sidebar) → **New bucket**.
2. Name: `agent-updates`
3. Toggle: **Private** (not public — the agent authenticates with the
   service-role key)
4. Click **Save**.

Do not create any folders inside it — the publish script manages the contents.

### Step 3 — Confirm agent config

In `agent/config.json`, confirm `"updateMode": "manual"` is set. This is the
only implemented mode — the agent refuses to start if it's set to anything
else.

```json
{
  "supabaseUrl": "https://your-project.supabase.co",
  "supabaseKey": "your-service-role-key",
  "updateMode": "manual",
  "fallbackPrinter": "",
  "tempDir": "./agent-temp",
  "maxRetries": 3
}
```

---

## Publishing a New Version

### Step 1 — Bump the version number

Edit `agent/version.json`:
```json
{ "version": "1.0.1" }
```

Rules:
- Must be a dotted numeric string: `1.0.0`, `1.2.3`, `2.0.0`, etc.
- Must be **strictly greater** than the version currently in `latest.json` in
  the bucket. The publish script checks this and refuses to proceed if not.
- You cannot republish an existing version. If `agent-1.0.1.zip` already
  exists in the bucket, the script stops with an error. Bump the version and
  try again.

### Step 2 — Run the publish command

From your developer machine (project root):

```powershell
npm run package:shop -- --publish
```

This script does the following — all automatic:

1. **Validates** `agent/config.json` has real Supabase credentials (not
   placeholder values)
2. **Resolves pinned versions** of the four agent runtime deps from
   `package-lock.json`: `@supabase/supabase-js`, `sharp`, `@hyzyla/pdfium`,
   `tsx`
3. **Installs** a minimal `node_modules` containing only those four packages
   (cuts zip size from ~190 MB to ~5 MB for code-only updates)
4. **Decides payload kind**:
   - `code` — only `agent/` folder changed since last publish (scripts + src),
     no runtime dependency version moved → ~100 KB zip
   - `full` — at least one runtime dependency version changed, or this is the
     first publish → full engine including `node_modules` → ~100 MB zip
5. **Strips `agent/config.json`** from the payload — shop credentials never
   travel in an update zip
6. **Checks** the `agent-updates` bucket to confirm this version isn't already
   published
7. **Checks** `latest.json` to confirm new version > currently published version
8. **Uploads** `agent-1.0.1.zip` to the bucket
9. **Writes `latest.json`** last (zip first so the manifest never points at a
   missing file):
   ```json
   {
     "version": "1.0.1",
     "kind": "code",
     "file": "agent-1.0.1.zip",
     "sha256": "abc123...",
     "publishedAt": "2026-08-07T10:00:00.000Z",
     "deps": { "@supabase/supabase-js": "2.x.x", ... }
   }
   ```
10. **Deletes** all previous `agent-*.zip` files from the bucket (only the
    current version is kept — saves Storage space)

You'll see output like:
```
Resolving pinned versions...
Installing minimal agent-only dependencies...
Zipping code update payload...
Uploading agent-1.0.1.zip (87 KB)...
Published code update 1.0.1, sha256=abc123...
Deleted 1 old zip(s): agent-1.0.0.zip
```

### Step 3 — Trigger the install on the shop PC

**Option A — Admin dashboard (recommended):**
1. Log in to `/admin` as **super_admin**.
2. The **Update** button appears in the topbar navbar when the agent's running
   version differs from the published version.
3. Click **Update** → a popup opens showing:
   - Running version (what's on the shop PC now)
   - Available version (what you just published)
   - Install button
4. Click **Install v1.0.1**.
5. The button shows a spinner — the popup closes, and the topbar badge starts
   polling every 5 seconds.

**Option B — Command line:**
```powershell
npm run agent:push-update
```
Does exactly the same thing as the Install button — writes the same DB row.

### Step 4 — Watch progress

The topbar Update badge polls every 5 seconds while in-flight and updates in
real time:

| Badge shows | Meaning |
|---|---|
| `requested` | DB row written; agent hasn't polled yet (max ~30s wait) |
| `downloading` | Agent is downloading the zip from Supabase Storage |
| `swapping` | Agent exited; SelfPrintUpdater BAT is replacing files on disk |
| `completed` | New version is running and has passed the health self-check |
| `failed` | Agent aborted before the swap — old version still running, safe to retry |
| `rolled_back` | Swap ran but new version failed health check — old version restored |

A print job that is currently running **defers the update** — the agent waits
until the job finishes before proceeding. At most 5 minutes of extra wait.

When done, the badge disappears (nothing to report — up to date).

---

## What Happens on the Shop PC (detailed)

### Phase 1 — Agent picks up the command

1. Agent's Supabase Realtime subscription fires within ~1 second of the DB
   row being written (WebSocket connection to Supabase). Fallback: 30s poll.
2. `checkForUpdateCommand()` in `agent/src/updater.ts` reads `agent_config`.
3. Guards that run before anything is downloaded:
   - `update_status` must be `requested`
   - `update_target_version` must be strictly greater than running version
   - Agent must not be mid-print (`isProcessing` flag)
4. Sets status `downloading` in DB.

### Phase 2 — Download and verify

1. Downloads `latest.json` from the `agent-updates` Storage bucket.
2. Verifies `latest.json.version` matches `update_target_version` in DB.
3. Downloads `agent-<version>.zip` (~100 KB for code, ~100 MB for full).
4. Verifies SHA-256 of downloaded bytes against `latest.json.sha256`. If
   mismatch: sets status `failed`, stops — nothing on disk was touched.
5. Extracts zip to `update-staging/update-extract/`.

### Phase 3 — Handoff to the updater BAT

1. Sets status `swapping` in DB.
2. Writes `update-pending.txt` with `from=1.0.0,to=1.0.1` (crash-recovery
   marker — survives a power cut mid-swap).
3. Writes `run-update.bat` from the `updater-template.bat` template, with
   the actual file paths baked in.
4. **Exits the agent process.** Windows Scheduled Task auto-restarts it.

### Phase 4 — New agent boot (brief handoff)

1. New agent process starts (same binary — still old files at this point).
2. Startup detects `update-pending.txt` → this is a post-update boot.
3. Launches **SelfPrintUpdater** scheduled task (which runs `run-update.bat`
   as a separate Windows process — outside the agent's own process so it can
   replace the agent's files).
4. Agent exits immediately (so SelfPrintUpdater can touch `engine/`).

### Phase 5 — SelfPrintUpdater BAT does the file swap

The BAT runs as a separate Windows Scheduled Task — completely outside the
agent process — so it can replace agent files without Windows file-locking
issues.

```
Before swap:                        After swap:
<shop-root>/                        <shop-root>/
├── engine/         (old version)   ├── engine/         (new version)
├── update-staging/                 ├── engine.bak/     (old version backup)
│   └── update-extract/  (new)      └── update-staging/ (cleaned up)
└── update-pending.txt              └── update-pending.txt (still present)
```

Steps inside the BAT:

1. **Rename** `engine → engine.bak` (5-attempt retry loop with 2s delay between
   tries — handles Windows file-locking edge cases)
2. For `code` update: **copy** new `agent/` folder into existing `engine/` (node_modules untouched)
   For `full` update: **rename** `update-extract → engine`
3. **Start** SelfPrintAgent scheduled task → new agent version boots
4. **Wait** up to 3 minutes, checking `agent-health.txt` every 5 seconds

### Phase 6 — New agent health check

1. New agent boots, runs startup self-check:
   - PDFium WASM library loads
   - Sharp native binding works
   - At least one Windows printer is enumerable
   - Supabase is reachable
2. If any check fails: no heartbeat is written → BAT detects this → rollback
3. If all checks pass: writes `agent-health.txt` with current timestamp
4. BAT sees fresh heartbeat → confirms success:
   - Deletes `engine.bak/`
   - Deletes `update-staging/update-extract/` and `update.zip`
   - Writes status `completed` + `agent_version = 1.0.1` + `agent_healthy_at = now()` to DB
   - Deletes `update-pending.txt`

### Rollback path

If the new agent does NOT write a heartbeat within 3 minutes:

1. BAT stops waiting, writes `update-failed.txt` with reason
2. Deletes broken `engine/`, renames `engine.bak → engine`
3. Starts SelfPrintAgent → old version boots again
4. Old agent reads `update-rollback.txt` → writes status `rolled_back` with
   reason to DB
5. Dashboard topbar badge turns red, shows reason string

Both `failed` and `rolled_back` leave a working agent running. Safe to retry
from the dashboard immediately after fixing the underlying problem.

---

## Sending the Zip to the Client (first install)

`npm run package:shop` (without `--publish`) produces the initial install zip
at `dist-shop-package/selfprint-agent.zip`. This is a ~100 MB file because it
includes pre-built `node_modules` — the shop PC needs no `npm install`.

**How to send it:**

- **WhatsApp / Telegram** — easiest for most clients; just share the file in chat
- **Google Drive / OneDrive link** — recommended for large files; upload and share a download link
- **USB drive** — if the shop PC has no internet yet during setup

After the client runs `SETUP.bat` once, they never need another zip — all
future updates come through the dashboard automatically.

---

## Troubleshooting

### Dashboard shows "Updating…" / `requested` status for more than 1 minute

The agent hasn't picked up the command. Causes:

1. **Agent not running on shop PC** — check Windows Task Scheduler for
   "SelfPrintAgent". If missing or stopped, run `SETUP.bat` again on the
   shop PC, or:
   ```powershell
   schtasks /Run /TN SelfPrintAgent
   ```

2. **No internet on shop PC** — agent can't reach Supabase. Fix the connection
   and the agent will pick up on its next 30s poll.

3. **Stuck status from a previous failed attempt** — clear it manually in
   Supabase SQL Editor:
   ```sql
   UPDATE agent_config
   SET update_status = null,
       update_target_version = null,
       update_started_at = null,
       update_message = null
   WHERE id = 1;
   ```
   Then retry from the dashboard.

### Status shows `failed`

The agent aborted before handing off to the updater BAT. The old version is
still running — nothing was swapped.

Check `engine\agent\agent.log` on the shop PC. Common causes:

| Log message | Fix |
|---|---|
| SHA-256 mismatch | Corrupted download — retry; if it keeps failing, delete and re-publish the version |
| `latest.json` missing | Create the `agent-updates` bucket if it doesn't exist, or re-publish |
| `SelfPrintUpdater` task not found | Run `SETUP.bat` again on the shop PC to re-register the tasks |
| Downgrade refused | `update_target_version` in DB is ≤ running version — check `agent/version.json` was bumped correctly before publishing |

### Status shows `rolled_back`

The swap ran but the new agent failed the health check. The old version was
restored automatically.

Check in order:

1. **`update-staging\updater.log`** on the shop PC — the BAT's own trace,
   shows exactly which step failed and why.
2. **`engine\agent\agent.log`** — startup errors from the new version attempt.
   Look for "SELF-CHECK FAILED".
3. If `updater.log` says **"ROLLBACK FAILED"**: `engine.bak/` is still present
   and the swap left no usable `engine/`. Rename manually:
   ```powershell
   ren "C:\SelfPrint\engine.bak" "engine"
   schtasks /Run /TN SelfPrintAgent
   ```

### Internet drops during update

| When internet drops | Effect |
|---|---|
| Before download starts | Agent retries on next 30s poll — no harm |
| Mid-download (zip transfer) | Download fails → status `failed` → retry from dashboard |
| After download, zip on disk | Swap runs fully offline (just file renames) — completes fine |
| After swap, before heartbeat | New agent can't reach Supabase → no heartbeat → BAT rolls back after 3 min |
| After heartbeat written | Done — DB status written when connection recovers |

### Agent healthy badge shows "offline" in the Printer panel

The agent's `agent_healthy_at` timestamp is >5 minutes old (or null). The
agent writes a heartbeat every 30 seconds. If it shows offline:

- Agent may not be running — check Task Scheduler
- Supabase Realtime or DB write is failing — check `agent.log` for errors
- First time setup — agent needs to run once post-SETUP.bat to write the
  first heartbeat

---

## Files on the Shop PC

```
<shop-root>/                     ← where selfprint-agent.zip was unzipped
├── SETUP.bat                    ← run once to register scheduled tasks
├── TEST-PRINTER.bat             ← send a test page to verify printer
├── README.txt
├── engine/                      ← live agent (replaced during updates)
│   ├── agent/
│   │   ├── agent.log            ← agent runtime log (rotates at 5 MB)
│   │   ├── agent.log.old        ← previous log rotation
│   │   ├── agent-health.txt     ← heartbeat (updated every 30s by running agent)
│   │   ├── config.json          ← shop credentials (NEVER replaced by updates)
│   │   ├── version.json         ← running version number
│   │   ├── src/                 ← agent TypeScript source
│   │   ├── SETUP.bat            ← real setup script (called by root SETUP.bat)
│   │   └── print-image.ps1     ← Windows GDI print helper
│   ├── node_modules/            ← runtime dependencies
│   └── package.json
├── engine.bak/                  ← backup of previous version (present during swap only)
├── update-staging/
│   ├── update.zip               ← downloaded payload (deleted after extract)
│   ├── update-extract/          ← unzipped payload (deleted after swap)
│   └── updater.log              ← SelfPrintUpdater BAT output
├── update-pending.txt           ← written pre-swap; consumed (deleted) after heartbeat
├── update-rollback.txt          ← written by BAT on rollback; consumed by agent
└── update-failed.txt            ← written by BAT on failure; consumed by agent
```

---

## Developer Notes

### Running the agent on a dev machine

On your own PC (not a shop PC), run the agent directly from the terminal:
```powershell
npm run agent
```

Do **NOT** run `SETUP.bat` on a dev machine — it installs real Windows
Scheduled Tasks ("SelfPrintAgent", "SelfPrintUpdater") that run on boot.

The updater guard in `agent/src/updater.ts` prevents self-update logic from
running on a dev machine:
```typescript
const IS_ENGINE_CWD = path.basename(process.cwd()) === "engine";
// update check returns immediately if not in the engine/ directory
if (!IS_ENGINE_CWD) return;
```

For a persistent dev agent (survives terminal close), use PM2:
```powershell
npm install -g pm2
pm2 start "npm run agent" --name selfprint-agent --cwd "C:\path\to\Selfprint"
pm2 save
pm2 startup
```

Stop/start:
```powershell
pm2 stop selfprint-agent
pm2 start selfprint-agent
pm2 logs selfprint-agent
```

### Version number rules

- Format: dotted numeric only — `1.0.0`, `1.2.3`, `2.0.0`
- Must be strictly greater than currently published version
- Cannot republish an existing version (publish script checks the bucket)
- Agent refuses to install any version ≤ its running version (downgrade guard
  in `agent/src/updater.ts`)
- The `package:shop` script also compares against `latest.json` in the bucket
  and rejects a downgrade at publish time

### What "code" vs "full" means for update size

| Kind | Contents | Typical size | When |
|---|---|---|---|
| `code` | `agent/` folder only (src + scripts) | ~100 KB | No runtime dependency changed |
| `full` | Entire `engine/` (code + node_modules) | ~100 MB | Any of the 4 runtime deps changed version |

The first publish is always `full` (no `latest.json` to compare deps against).
Subsequent publishes are usually `code` unless you `npm update` one of the
four agent-specific packages.

### Audit log

Every update attempt is logged to the `agent_update_events` table in Supabase.
View it in the Table Editor, or query:
```sql
SELECT * FROM agent_update_events ORDER BY created_at DESC LIMIT 20;
```

Columns: `event_type` (requested / downloading / completed / failed /
rolled_back), `from_version`, `to_version`, `message`, `created_at`.
