# agent/ — Windows print agent

This folder is kept sparse on purpose so a shop-PC client only sees what
they actually need to touch.

## Run these

| File | When |
|---|---|
| `SETUP.bat` | Run once, the first time this is set up on a shop PC. Checks Node is installed, registers the printer service to auto-start on every boot, and starts it immediately. Double-click it. |
| `TEST-PRINTER.bat` | Optional. Sends one test page straight to a chosen printer, to check the printer connection without going through the full upload → approve → print flow. |

Full non-technical walkthrough: [`../docs/CLIENT_PC_SETUP.md`](../docs/CLIENT_PC_SETUP.md).

## Leave these alone

Everything below is internal machinery `SETUP.bat` depends on. They have
hardcoded relative paths to each other and to the repo root — moving or
renaming any of them breaks the setup.

- `config.json` — Supabase URL/key + printer settings. Pre-filled before
  the client ever sees this folder; not something to open or edit.
- `print-image.ps1` — the actual print job: renders pages and spools them
  to the Windows printer via `System.Drawing.Printing`.
- `START-PRINTER.bat` — the loop that actually runs `npm run agent`
  (auto-restarts on crash). Launched hidden by the `.vbs` below; don't
  double-click it directly unless troubleshooting.
- `START-PRINTER-BACKGROUND.vbs` — a 1-line invisible wrapper around
  `START-PRINTER.bat`, used by the Windows Scheduled Task so no console
  window appears at login.
- `src/` — the agent's actual code (`src/index.ts`), run via `tsx`.

## `dev-tools/` — developer-only, never needed by a shop-PC client

| File | Purpose |
|---|---|
| `config.example.json` | Template for `config.json` — copy it when setting up a brand-new deployment. |
| `INSTALL-AUTOSTART.bat` | What `SETUP.bat` used to be split into (the autostart-registration half only). Superseded by `SETUP.bat`; kept for re-running just that half if ever needed. |
| `start-agent.bat` | An older, plainer auto-restart loop for `npm run agent`, superseded by `START-PRINTER.bat`. Kept for reference; safe to delete if you never use it. |
| `STOP-DEV-AGENT.bat` | Kills a stray agent process running on a *developer's own machine* (e.g. a dev laptop accidentally left running and stealing print jobs meant for the shop PC). Never needed on the actual shop PC. |
