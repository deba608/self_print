# Shop-PC one-click agent setup

## Problem

The print agent currently needs 3+ manual steps on the shop PC before it
runs unattended: copy `agent/config.example.json` → `config.json` and hand-edit
it, run `START-PRINTER.bat`, separately run `INSTALL-AUTOSTART.bat` as admin.
The client is non-technical and this is a one-shop, one-time setup — every
manual step is a chance to get stuck.

## Scope

This shop only. Not building a reusable multi-client installer, not building
a GUI, not building a signed `.exe`. Node.js is already installed on the
target PC.

## Design

**One consolidated script, one double-click, done forever.**

### 1. `agent/SETUP.bat` (new)

Replaces the two-script flow (`START-PRINTER.bat` + `INSTALL-AUTOSTART.bat`)
with a single entry point that does both, in order, in one run:

1. Sanity checks (Node installed, `config.json` present) — same plain-English
   `[PROBLEM]` messaging pattern already used in `START-PRINTER.bat`.
2. Self-elevates to admin (same pattern as `INSTALL-AUTOSTART.bat`).
3. Registers the Windows Scheduled Task (`SelfPrintAgent`, trigger `AtLogOn`,
   auto-restart) pointing at the existing hidden `START-PRINTER-BACKGROUND.vbs`
   wrapper — unchanged, still the thing that keeps the agent alive silently.
4. Immediately runs the task once (`schtasks /Run /TN SelfPrintAgent`) so the
   client sees it working right away instead of waiting for next login.
5. Prints a short "you're done, printer service is running in the
   background" message and exits — no window needs to stay open, since the
   scheduled task already owns the running process via the `.vbs` wrapper.

`START-PRINTER.bat`, `INSTALL-AUTOSTART.bat`, `START-PRINTER-BACKGROUND.vbs`,
`TEST-PRINTER.bat` all stay as-is in the repo (still useful individually for
troubleshooting / re-running autostart install / testing the printer) — this
is an additive consolidation, not a replacement of the underlying mechanism.

### 2. Pre-baked `agent/config.json`

Not committed to git (already gitignored). Filled in locally from this
machine's real `.env` values before packaging, so the client never opens or
edits JSON. `fallbackPrinter` left blank — printer selection happens via the
`/admin` dashboard, which the agent already reads from (`checkPrinterConfig`)
independently of this field.

### 3. Bundled `node_modules`

The zip given to the client includes `node_modules` already installed (from
this dev machine, Windows x64 — same OS/arch as the shop PC), so no `npm
install` step runs on-site at all. Removes the only step in the current flow
that needs internet access during setup.

### 4. Delivery

One zip file. Client: unzip anywhere → double-click `agent/SETUP.bat` → done.

## Out of scope / explicitly rejected

- **GUI installer / signed `.exe`** — unsigned exes trigger Windows
  SmartScreen ("this app might harm your PC"), which is a worse first
  impression for a non-technical client than a plain `.bat`. Code signing
  costs money and is pointless for a single-shop internal tool never
  publicly distributed.
- **Python** — client PC doesn't have Python; would add a second runtime
  dependency for no capability the existing Node/batch/PowerShell stack
  doesn't already have. A Python-built GUI exe hits the same SmartScreen
  wall as any other unsigned exe anyway.
- **NSSM / Windows Service wrapper** — the existing Scheduled Task approach
  already restarts on crash and survives reboot; a real Windows service adds
  a new dependency for marginal benefit at this scale.
- **Multi-shop reusability** — not needed; this is scoped to one shop.

## Risks / open items

- If the shop PC's printer name differs from whatever's in `/admin`'s
  printer config at delivery time, staff picks the printer from the
  dashboard once, same as today — not a new manual step introduced by this
  change.
- Bundling `node_modules` assumes shop PC is Windows x64, same as this dev
  machine. If the shop PC turns out to be ARM64 or 32-bit, prebuilt native
  binaries (`sharp`, `better-sqlite3`, PDFium) won't load — fallback in that
  case is deleting `node_modules` and letting `SETUP.bat` run `npm install`
  itself (needs an internet-availability check added to the script as a
  fallback path, or manually running `npm install` once by hand).
