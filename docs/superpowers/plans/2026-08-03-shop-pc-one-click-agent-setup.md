# Shop-PC One-Click Agent Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shop PC's current 3-step manual agent setup (hand-edit `config.json`, run `START-PRINTER.bat`, separately run `INSTALL-AUTOSTART.bat`) with a single pre-packaged zip the client unzips and double-clicks once.

**Architecture:** One new consolidated batch script (`agent/SETUP.bat`) that combines the existing sanity-checks + autostart-registration + immediate-run logic already proven in `START-PRINTER.bat`/`INSTALL-AUTOSTART.bat`, plus one new Node packaging script (`scripts/package-for-shop.mjs`) that assembles a self-contained zip (bundled `node_modules`, real `agent/config.json`, the new setup script) requiring zero installs or edits on the shop PC.

**Tech Stack:** Windows batch + PowerShell (existing patterns in `agent/`), Node.js `child_process`/`fs` for the packaging script (no new npm dependency — uses PowerShell's `Compress-Archive` for zipping, invoked via `execFileSync`).

## Global Constraints

- Single shop, one-time setup — do not build multi-client templating, GUI installer, or signed `.exe` (spec: "Out of scope / explicitly rejected").
- Node.js already installed on the shop PC — no runtime bootstrap needed.
- `agent/config.json` is already gitignored and already contains real, working Supabase credentials on this dev machine (`supabaseUrl`, `supabaseKey`, `fallbackPrinter: ""`, `tempDir: "./agent-temp"`, `maxRetries: 3`) — copy as-is, do not regenerate or template it.
- The bundled `node_modules` must be a full `npm install` (not `--omit=dev`) because `tsx` (required by `npm run agent` → `tsx agent/src/index.ts`) lives in `devDependencies`.
- Never register the real `SelfPrintAgent` scheduled task on this dev machine during testing — it would make the dev machine also try to claim print jobs, which is exactly what `STOP-DEV-AGENT.bat` exists to undo. All test runs of scheduled-task logic must use a throwaway task name and must delete it afterward.
- Existing files (`START-PRINTER.bat`, `INSTALL-AUTOSTART.bat`, `START-PRINTER-BACKGROUND.vbs`, `TEST-PRINTER.bat`, `STOP-DEV-AGENT.bat`, `print-image.ps1`) stay unmodified — this is additive, not a replacement of the underlying mechanism.

---

### Task 1: `agent/SETUP.bat` — consolidated one-click setup script

**Files:**
- Create: `agent/SETUP.bat`

**Interfaces:**
- Consumes: `agent/config.json` (must exist — same contract as `agent/src/index.ts`'s `loadConfig()`), `agent\START-PRINTER-BACKGROUND.vbs` (existing, unmodified — the hidden-window wrapper this script's scheduled task will point at)
- Produces: a Windows Scheduled Task named `SelfPrintAgent` (same name `INSTALL-AUTOSTART.bat` already uses — this script replaces it, not runs alongside it), immediately triggered once

- [ ] **Step 1: Write the script**

```batch
@echo off
title SelfPrint - One-Click Setup
color 0B
cd /d "%~dp0.."

echo ================================================
echo       SELFPRINT - ONE-CLICK PRINTER SETUP
echo ================================================
echo.
echo  This sets up the printer service to run by itself,
echo  every time this computer turns on. Run this ONCE.
echo ------------------------------------------------
echo.

REM --- Check Node.js is installed ---
where node >nul 2>nul
if errorlevel 1 (
  color 0C
  echo.
  echo  [PROBLEM] Node.js is not installed.
  echo.
  echo  FIX: Install from  https://nodejs.org
  echo       Pick the "LTS" button, run it, click Next/Next/Finish.
  echo       Then restart this file.
  echo.
  pause
  exit /b
)

REM --- Check config exists ---
if not exist "agent\config.json" (
  color 0C
  echo.
  echo  [PROBLEM] Missing file: agent\config.json
  echo.
  echo  FIX: Call the developer. Send a screenshot of this window.
  echo.
  pause
  exit /b
)

REM --- Install dependencies only if missing (bundled package ships them
REM     already installed; this is a safety net for a mismatched CPU
REM     architecture where the bundled node_modules won't load) ---
if not exist "node_modules" (
  echo.
  echo  First-time setup... installing. This may take 2-5 minutes.
  echo  Do NOT close the window. Wait for it to finish.
  echo.
  call npm install
  if errorlevel 1 (
    color 0C
    echo.
    echo  [PROBLEM] Setup failed. Check internet connection and try again.
    echo  If it keeps failing, send a photo of this window to the developer.
    echo.
    pause
    exit /b
  )
)

REM --- Self-elevate to Administrator (needed to register the scheduled task) ---
net session >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Requesting administrator permission...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

set "VBS=%~dp0START-PRINTER-BACKGROUND.vbs"

if not exist "%VBS%" (
  color 0C
  echo.
  echo  [PROBLEM] Cannot find START-PRINTER-BACKGROUND.vbs next to this file.
  echo  Keep all files in the same folder and try again.
  echo.
  pause
  exit /b
)

echo.
echo  Installing startup task (runs hidden in background)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('\"' + '%VBS%' + '\"');" ^
  "$t = New-ScheduledTaskTrigger -AtLogOn;" ^
  "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero);" ^
  "Register-ScheduledTask -TaskName 'SelfPrintAgent' -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force | Out-Null"

if errorlevel 1 (
  color 0C
  echo.
  echo  [PROBLEM] Install failed. Send a photo of this window to the developer.
  echo.
  pause
  exit /b
)

echo.
echo  Starting the printer service now...
schtasks /Run /TN "SelfPrintAgent" >nul 2>nul

color 0A
echo.
echo  ================================================
echo   DONE! The printer service is now running
echo   quietly in the background, and will start
echo   itself every time this computer turns on.
echo  ================================================
echo.
echo  You do not need to keep any window open.
echo  To test the printer, run TEST-PRINTER.bat.
echo.
echo  IMPORTANT - last step for FULLY hands-free:
echo   Turn ON Windows auto-login so it starts without
echo   typing a password after restart.
echo   (Ask the developer to set this up.)
echo.
pause
```

- [ ] **Step 2: Verify the script's checks fire correctly, without touching the real scheduled task**

Run this from the repo root to confirm the Node/config guard clauses behave (this does NOT reach the scheduled-task section because we simulate a missing config first):

```bash
cd agent
mv config.json config.json.bak
cmd //c SETUP.bat
```

Expected output: prints the `[PROBLEM] Missing file: agent\config.json` block and pauses (exits without touching scheduled tasks). Confirm by checking no task was created:

```powershell
powershell -Command "Get-ScheduledTask -TaskName 'SelfPrintAgent' -ErrorAction SilentlyContinue"
```

Expected: no output (or only a pre-existing task from unrelated prior work — must not be newly created by this run).

- [ ] **Step 3: Restore config and verify the scheduled-task logic in isolation, under a throwaway name**

Restore the real config first:

```bash
cd agent
mv config.json.bak config.json
```

Do **not** run `SETUP.bat` directly for this check (it would register the real `SelfPrintAgent` task on this dev machine). Instead validate the exact `Register-ScheduledTask` command used inside the script, substituting a throwaway task name, directly via PowerShell:

```powershell
$VBS = (Resolve-Path "agent\START-PRINTER-BACKGROUND.vbs").Path
$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $VBS + '"')
$t = New-ScheduledTaskTrigger -AtLogOn
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'SelfPrintAgentTEST' -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force | Out-Null
Get-ScheduledTask -TaskName 'SelfPrintAgentTEST'
```

Expected: prints the task with `State: Ready` — confirms the exact command syntax used in `SETUP.bat` registers successfully on this OS/PowerShell version.

- [ ] **Step 4: Clean up the throwaway task immediately**

```powershell
Unregister-ScheduledTask -TaskName 'SelfPrintAgentTEST' -Confirm:$false
Get-ScheduledTask -TaskName 'SelfPrintAgentTEST' -ErrorAction SilentlyContinue
```

Expected: second command produces no output — task fully removed. Do not leave `SelfPrintAgentTEST` (or `SelfPrintAgent`) registered on this dev machine.

- [ ] **Step 5: Commit**

```bash
git add agent/SETUP.bat
git commit -m "feat: add one-click SETUP.bat consolidating agent config-check, autostart registration, and first run"
```

---

### Task 2: `scripts/package-for-shop.mjs` — assemble the delivery zip

**Files:**
- Create: `scripts/package-for-shop.mjs`

**Interfaces:**
- Consumes: repo root `package.json`, `package-lock.json`, `node_modules/` (must already be installed via plain `npm install`, not `--omit=dev`), `agent/` folder (including the real `agent/config.json` and the `agent/SETUP.bat` from Task 1)
- Produces: `dist-shop-package/selfprint-agent.zip` — the file handed to the client

- [ ] **Step 1: Write the packaging script**

```js
import { existsSync, mkdirSync, rmSync, cpSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

const root = process.cwd();
const stageDir = path.join(root, 'dist-shop-package', 'selfprint-agent');
const zipPath = path.join(root, 'dist-shop-package', 'selfprint-agent.zip');

// Fresh staging directory every run.
rmSync(path.join(root, 'dist-shop-package'), { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

// Fail loudly and early if the source config is missing or still the
// placeholder — a client package with fake credentials would silently
// never connect and every job would sit stuck at "approved".
const configPath = path.join(root, 'agent', 'config.json');
if (!existsSync(configPath)) {
  console.error('Missing agent/config.json — copy agent/config.example.json and fill in real values first.');
  process.exit(1);
}
const config = JSON.parse(await import('fs/promises').then(m => m.readFile(configPath, 'utf8')));
if (!config.supabaseUrl || config.supabaseUrl.includes('your-project') || !config.supabaseKey || config.supabaseKey.includes('your-service-role-key')) {
  console.error('agent/config.json still has placeholder values — fill in the real Supabase URL/key before packaging.');
  process.exit(1);
}

// node_modules must be a full install (not --omit=dev): tsx (needed by
// `npm run agent`) lives in devDependencies.
const tsxBin = path.join(root, 'node_modules', '.bin', 'tsx.cmd');
if (!existsSync(tsxBin)) {
  console.error('node_modules/.bin/tsx.cmd not found — run a plain "npm install" (not --omit=dev) before packaging.');
  process.exit(1);
}

console.log('Copying package.json, package-lock.json, node_modules, agent/...');
cpSync(path.join(root, 'package.json'), path.join(stageDir, 'package.json'));
cpSync(path.join(root, 'package-lock.json'), path.join(stageDir, 'package-lock.json'));
cpSync(path.join(root, 'node_modules'), path.join(stageDir, 'node_modules'), { recursive: true });
cpSync(path.join(root, 'agent'), path.join(stageDir, 'agent'), {
  recursive: true,
  // agent.log / agent.log.old are this dev machine's own run history —
  // the shop PC starts with a clean log.
  filter: (src) => !src.endsWith('agent.log') && !src.endsWith('agent.log.old')
});

console.log('Zipping...');
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path "${stageDir}\\*" -DestinationPath "${zipPath}" -Force`
]);

console.log(`Done: ${zipPath}`);
console.log('Client instructions: unzip anywhere, double-click agent\\SETUP.bat, done.');
```

- [ ] **Step 2: Run it and verify the zip's actual contents**

```bash
node scripts/package-for-shop.mjs
```

Expected console output: `Copying package.json, package-lock.json, node_modules, agent/...` then `Zipping...` then `Done: <path>\selfprint-agent.zip`.

- [ ] **Step 3: Verify the zip contains what the shop PC needs, without a stray real scheduled task or leftover dev log**

```powershell
powershell -Command "Expand-Archive -Path dist-shop-package\selfprint-agent.zip -DestinationPath dist-shop-package\verify -Force; Get-ChildItem dist-shop-package\verify -Recurse -Depth 1 | Select-Object Name"
```

Expected: listing includes `package.json`, `package-lock.json`, `node_modules`, `agent` — and inside `agent`: `SETUP.bat`, `START-PRINTER.bat`, `START-PRINTER-BACKGROUND.vbs`, `INSTALL-AUTOSTART.bat`, `TEST-PRINTER.bat`, `STOP-DEV-AGENT.bat`, `print-image.ps1`, `config.json`, `src` — and does **not** include `agent.log` or `agent.log.old`.

Then confirm the copied config isn't a placeholder:

```bash
node -e "const c=require('./dist-shop-package/verify/agent/config.json'); console.log(c.supabaseUrl.includes('your-project') ? 'FAIL: placeholder' : 'OK: real value present')"
```

Expected: `OK: real value present`.

- [ ] **Step 4: Clean up verification artifacts (keep the zip itself)**

```bash
rm -rf dist-shop-package/verify dist-shop-package/selfprint-agent
```

- [ ] **Step 5: Add `dist-shop-package/` to `.gitignore`**

This directory contains real Supabase credentials (via the copied `config.json`) and must never be committed.

```bash
echo "" >> .gitignore
echo "# Generated shop-PC delivery package (contains real credentials)" >> .gitignore
echo "dist-shop-package/" >> .gitignore
```

Verify it's ignored:

```bash
git status --short
```

Expected: `dist-shop-package/` does not appear (neither the folder nor the zip inside it).

- [ ] **Step 6: Commit**

```bash
git add scripts/package-for-shop.mjs .gitignore
git commit -m "feat: add scripts/package-for-shop.mjs to assemble the one-click shop-PC delivery zip"
```

---

### Task 3: Update `docs/CLIENT_PC_SETUP.md` to describe the new one-click flow

**Files:**
- Modify: `docs/CLIENT_PC_SETUP.md` (Path A, "Step 2 — Print agent on the shop PC" section)

**Interfaces:**
- Consumes: nothing new — this is a documentation-only change
- Produces: nothing consumed by other tasks — this is the last task in the plan

- [ ] **Step 1: Replace the multi-step Step 2 with the one-click flow**

Find the existing "Step 2 — Print agent on the shop PC (do this on-site)" section (steps 1-6, from "Install Node.js" through "Test it end-to-end") and replace steps 3-5 (configure agent / start printer service / autostart) with:

```markdown
3. **Unzip the pre-packaged agent folder** you received from the developer
   (`selfprint-agent.zip`) — anywhere, e.g. `C:\SelfPrint`. It already
   contains everything needed: dependencies, and `agent\config.json`
   pre-filled with this shop's real Supabase credentials. Nothing to edit.
4. **Double-click `agent\SETUP.bat`** — this single script checks Node is
   installed, registers the printer service to start automatically every
   time this computer turns on, and starts it immediately. Click "Yes" if
   Windows asks for administrator permission.
   - When you see **"DONE!"**, the printer service is live — no window
     needs to stay open.
   - For this to be fully hands-free, also turn on **Windows auto-login**
     for that PC's user account (Settings → Accounts → Sign-in options) —
     otherwise the scheduled task still waits for someone to log in first.
```

Keep step 1 (Install Node.js), step 2 (renumber: "Get the delivery zip from the developer" instead of `git clone`), and the former step 6 ("Test it end-to-end") — renumber to step 5, unchanged in content.

Also update the "Optional — DOC/DOCX support" and "Day-to-day operation" / "Troubleshooting quick reference" sections' references from "reopen `agent\START-PRINTER.bat`" to "reopen `agent\SETUP.bat`" for consistency, since that's now the client-facing entry point (the underlying `START-PRINTER.bat` still exists for the hidden autostart path, but the client never runs it directly anymore).

- [ ] **Step 2: Proofread the whole Path A section top to bottom**

Confirm the numbered steps still read coherently after renumbering (no orphaned "Step 4" references pointing at the wrong content, no leftover mention of manually copying `agent/config.example.json`).

- [ ] **Step 3: Commit**

```bash
git add docs/CLIENT_PC_SETUP.md
git commit -m "docs: update client PC setup guide for the one-click SETUP.bat flow"
```
