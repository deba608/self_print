# SelfPrint — Shop PC Setup Guide

This guide sets up the **print agent** on the shop counter PC (Windows).

The website (customer upload + admin dashboard) is already live on **Vercel**, and the
database + file storage are on **Supabase**. This PC's only job is to print approved jobs.

> **You do NOT need a `.env` file on this PC.** The agent reads only `agent/config.json`.
> `.env` / `AGENT_TOKEN` belong to the website on Vercel, not here.

---

## What this PC does

Every 5 seconds the agent:
1. Checks Supabase for jobs the admin has released ("approved")
2. Downloads the file
3. Prints it via the Windows printer
4. Marks the job "printed"

Needs: **internet** + the **shop printer installed in Windows**.

---

## Step 0 — Prerequisites

1. **Node.js 18+** — install from <https://nodejs.org> → click **LTS** → Next / Next / Finish.
2. **Printer** — install the shop printer in Windows (Settings → Bluetooth & devices → Printers)
   and confirm it prints a normal Windows test page. Note its **exact name**.
3. **Project folder** — copy the whole `Selfprint` project folder onto this PC
   (USB or `git clone`). Keep all files together in one folder.

---

## Step 1 — Create the agent config

`agent/config.json` is not shipped (it holds secrets). Create it:

1. Copy `agent/config.example.json` → `agent/config.json`
2. Fill it in:

```json
{
  "supabaseUrl": "https://YOUR-PROJECT.supabase.co",
  "supabaseKey": "YOUR-SERVICE-ROLE-KEY",
  "tempDir": "./agent-temp",
  "maxRetries": 3,
  "fallbackPrinter": "Your Exact Printer Name"
}
```

| Field | Value |
|-------|-------|
| `supabaseUrl` | Same project as the website. Supabase dashboard → Settings → API → Project URL |
| `supabaseKey` | **Service Role Key** (Settings → API → service_role). Full DB access. |
| `fallbackPrinter` | Printer used when the admin didn't pick one. Paste the exact name from Step 0. |

> ⚠️ **Security:** the Service Role Key gives full database access. Keep `config.json`
> on this PC only. Never commit it, never share it.

> **fallbackPrinter:** leave it blank **only** if the admin dashboard always selects a
> printer for every job. Otherwise jobs fail with "No printer selected".

---

## Step 2 — Test the printer

Double-click **`TEST-PRINTER.bat`**.

- It lists installed printers → type the exact name (or leave blank for the default) → Enter.
- A page comes out → good.
- No page → printer off, out of paper, or the name is misspelled.

---

## Step 3 — First run

Double-click **`START-PRINTER.bat`**.

- First time it runs `npm install` (2–5 min). **Do not close the window.**
- If `better-sqlite3` fails to build ("no C++ tools") — **ignore it**. It's optional; the
  agent uses Supabase, not local SQLite.
- When you see **"Connected"**, printing is **LIVE**.
- Keep this window **open** while the shop is running. Closing it stops printing.
  It auto-restarts itself if it crashes.

---

## Step 4 — Hands-free auto-start (recommended)

Double-click **`INSTALL-AUTOSTART.bat`** → approve the administrator prompt.

- Registers a Windows Task named `SelfPrintAgent`.
- Starts the agent **hidden** at every logon; restarts it every 1 min if it dies.
- **Run this once.** After that the agent starts by itself on boot — no window to open.

**For fully unattended (starts after a power cut with no one at the keyboard):**
turn on Windows **auto-login** so the PC boots to the desktop without a password.
Run `netplwiz` → select the user → uncheck **"Users must enter a user name and password"** → Apply.

---

## Verify end-to-end

1. **Phone:** scan the QR code → upload a file → get a token.
2. **Admin dashboard:** mark the job **Paid** → click **Release Print**.
3. Within ~5 seconds the agent picks it up → the page prints → status becomes **printed**.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Node.js is not installed" | Install LTS from nodejs.org, rerun START-PRINTER.bat |
| "Missing agent\config.json" | Redo Step 1 |
| "No printer selected" | Set `fallbackPrinter`, or pick a printer in the admin dashboard |
| Job stuck on "approved" | Agent window should say "Connected". Check internet. |
| Wrong / no printer prints | `fallbackPrinter` name mismatch — copy the exact name from the TEST-PRINTER list |
| Setup failed during install | Check internet, rerun. If it repeats, send a photo of the window to the developer. |

---

## Start / stop reference

| Action | How |
|--------|-----|
| Start manually | Double-click `START-PRINTER.bat` |
| Test one page | Double-click `TEST-PRINTER.bat` |
| Install auto-start | Double-click `INSTALL-AUTOSTART.bat` (once) |
| Stop now | Close the service window, or `schtasks /End /TN SelfPrintAgent` |
| Remove auto-start | `schtasks /Delete /TN SelfPrintAgent /F` |

---

## What lives where (reference)

| Piece | Location | Config |
|-------|----------|--------|
| Customer upload + admin website | Vercel | Vercel env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AGENT_TOKEN`, `CRON_SECRET`, `SESSION_SECRET`) |
| Database + file storage | Supabase | — |
| **Print agent (this PC)** | **Shop Windows PC** | **`agent/config.json` only — no `.env`** |
