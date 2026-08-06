# Setting Up SelfPrint on the Shop's Windows PC

This guide covers putting SelfPrint into real use at a print shop. There are
two things that can live on the shop PC, and you don't have to run both:

1. **The print agent** — always runs on the shop PC. It watches for approved
   jobs and sends them to the physical printer. Required in every setup.
2. **The web app** (customer upload page + admin dashboard) — can run in the
   cloud (recommended) or locally on the same shop PC (fully offline).

Pick a path below before starting.

---

## Which setup do you need?

| | **Path A: Cloud-hosted (recommended)** | **Path B: Fully local** |
|---|---|---|
| Web app runs on | Vercel (internet) | The shop PC itself |
| Database | Supabase (Postgres) | Local SQLite file |
| Works if shop internet drops | Customers can't upload; already-approved jobs still print | Everything works — printing keeps working, upload only needs the shop's own Wi-Fi |
| Staff login / accounts | Yes | No (SQLite mode has no login — see `docs/LOCAL_DEV_AUTH.md`) |
| Multi-location / access from anywhere | Yes | No — admin dashboard only reachable from the shop's own network |
| Setup effort | One-time cloud setup (~20 min), then just the agent on each shop PC | Everything on one machine, but that machine must stay on and reachable on the shop Wi-Fi |

**Recommendation: Path A.** It's what this app was built for — the
architecture diagram in the README assumes Vercel + Supabase, with only the
print agent and printer living at the shop. Use Path B only if the shop has
no reliable internet or you deliberately want a single offline machine.

The rest of this guide does Path A first, then Path B as an alternative.

---

## Path A: Cloud-hosted web app + local print agent

### Step 1 — One-time cloud setup (do this once, from any computer)

You need a Supabase project (database + file storage + login) and a Vercel
deployment (the actual website). This does not have to be done on the shop
PC — do it from your own laptop, then only Step 2 happens on-site.

1. **Create a Supabase project** at [supabase.com](https://supabase.com) —
   free tier is enough to start.
2. **Get your keys**: Project Settings → API. You'll need:
   - `Project URL` → becomes both `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key (keep secret, never expose in the browser) →
     `SUPABASE_SERVICE_ROLE_KEY`
3. **Run the database migrations** against that project (creates the `jobs`,
   `staff_profiles`, etc. tables — see `PROJECT.md` for the schema list and
   any migration files in the repo).
4. **Deploy the web app to Vercel**: connect this repo, and set the
   environment variables from `.env.example` in the Vercel project settings
   (at minimum: `AGENT_TOKEN`, `SESSION_SECRET`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SHOP_NAME`, `CRON_SECRET`). Deploy.
5. **Create the first staff login** (super admin) — no self-service signup
   exists on purpose, so this one has to be done by hand:
   - Supabase Dashboard → Authentication → Add user (email + password)
   - Supabase Dashboard → Table Editor → `staff_profiles` → insert a row for
     that user's ID with `role = 'super_admin'`
   - That person can then invite other staff from `/admin/staff`.
6. **Print the shop's QR code** — `docs/selfprint-shop-qr-a4.pdf` (or the
   `.html` next to it) points customers at your Vercel URL. Regenerate it if
   your production URL differs from what's baked into that file.

At this point the website works from any phone — but nothing prints yet.
That's what Step 2 does on the shop PC.

### Step 2 — Print agent on the shop PC (do this on-site)

This is the part that actually lives at the shop, on the PC connected to the
printer.

1. **Install Node.js** — download the **LTS** version from
   [nodejs.org](https://nodejs.org), run the installer, click through
   Next/Next/Finish (defaults are fine).
2. **Get and unzip the delivery package** — receive `selfprint-agent.zip`
   from the developer and copy it to the shop PC. Unzip it anywhere (e.g.
   `C:\SelfPrint`). It contains everything needed: dependencies, and
   `agent\config.json` pre-filled with this shop's real Supabase credentials.
   Nothing to edit.
   - **Security note**: the zip file contains a live Supabase service-role key
     (inside `agent\config.json`). Delete the zip from your Downloads folder
     after extraction — don't leave it sitting around unencrypted.
3. **Double-click `agent\SETUP.bat`** — this single script checks Node is
   installed, registers the printer service to start automatically every
   time this computer turns on, and starts it immediately. Click "Yes" if
   Windows asks for administrator permission.
   - When you see **"DONE!"**, the printer service is live — no window
     needs to stay open.
   - For this to be fully hands-free, also turn on **Windows auto-login**
     for that PC's user account (Settings → Accounts → Sign-in options) —
     otherwise the scheduled task still waits for someone to log in first.
4. **Test it end-to-end**: scan the shop QR code on your phone, upload a
   test file, have staff approve it from `/admin`, and confirm it prints.
   `agent\TEST-PRINTER.bat` also sends a one-off test page directly, useful
   for checking the printer connection without going through the full flow.

**Optional — DOC/DOCX support**: if the shop wants to accept Word documents
(not just PDF/image), install **LibreOffice** on the shop PC (any recent
version) so `npm run convert` can turn `.docx` uploads into PDF before
printing. Point `LIBREOFFICE_PATH` at `soffice.exe` if it's not in the
default install location. Skip this if PDF-only is fine.

---

## Path B: Fully local (single offline PC)

Use this only if the shop has no reliable internet, or you specifically want
everything on one machine with no cloud dependency. The customer's phone
still needs the shop's own Wi-Fi to reach this PC.

1. **Install Node.js** (same as Path A, Step 2.1).
2. **Get the project onto the PC** (same as Path A, Step 2.2).
3. **Install dependencies and seed the local database**:
   ```powershell
   npm install
   npm run db:seed
   ```
4. **Create a `.env` file** (copy `.env.example` → `.env`) and set at least:
   ```
   AGENT_TOKEN=some-random-secret
   SESSION_SECRET=some-random-secret
   SHOP_NAME=Your Shop Name
   ```
   Leave every `SUPABASE_*` variable blank — that's what tells the app to
   use local SQLite instead of the cloud. Note: in this mode there is no
   staff login (see `docs/LOCAL_DEV_AUTH.md`) — the admin dashboard is only
   protected by being on the shop's own network.
5. **Find the PC's local IP address** (so phones on the same Wi-Fi can reach
   it): open PowerShell and run:
   ```powershell
   ipconfig
   ```
   Look for the `IPv4 Address` under your active Wi-Fi/Ethernet adapter
   (e.g. `192.168.1.42`).
6. **Build and start the app for real use** (not `npm run dev`, which is for
   development only):
   ```powershell
   npm run build
   npm run start
   ```
   By default this serves on port 3000. Customers on the shop Wi-Fi reach it
   at `http://192.168.1.42:3000` (use your actual IP from Step 5).
   - **Keep this running continuously** — same as the print agent, use
     Task Scheduler (or a tool like [PM2](https://pm2.keymetrics.io/)) to
     auto-start `npm run start` on boot if you want it hands-off.
   - **Windows Firewall** may prompt to allow Node.js on first run — allow it
     on Private networks so phones on the shop Wi-Fi can connect.
7. **Print the QR code** pointing at that local address (regenerate
   `docs/selfprint-shop-qr-a4.pdf` with the shop's actual IP baked in — it
   defaults to a production URL).
8. **Set up the print agent** — same as Path A, Steps 2.3–2.6, except
   `agent\config.json` isn't really needed for cloud auth in this mode.
   Check `agent/src/index.ts` — if you're running fully local without
   Supabase, confirm with whoever built this whether the agent needs
   adjusting to read from the local SQLite file instead (the agent as
   shipped talks to Supabase directly; local-only shops typically still use
   Path A's cloud agent connection even while running the customer-facing
   site locally — ask before assuming this works unmodified).

---

## Day-to-day operation (either path)

- **Printer service** (Path A/B): runs hidden in the background as the
  "SelfPrintAgent" Windows Scheduled Task — no window appears after setup
  completes. If printing stops, check the log file `agent\agent.log` for
  diagnostic messages. To restart the service manually, either reboot the PC
  or run this command in PowerShell or cmd:
  ```powershell
  schtasks /Run /TN SelfPrintAgent
  ```
- **Updates**: nothing to do. When a new version of the printer service is
  released, it installs itself in the background (never while a job is
  printing) and restarts on its own — no download, no re-running SETUP.bat,
  no settings to re-enter. If the new version doesn't come up healthy, the
  PC automatically goes back to the version that was working.
- **Cleanup**: `npm run cleanup` removes finished/expired jobs and their
  files. Schedule this (Task Scheduler locally, or a Vercel Cron Job in
  Path A hitting `/api/cleanup` with `CRON_SECRET`) so storage doesn't grow
  forever.
- **Adding staff**: existing admins invite more from `/admin/staff` — no
  need to touch Supabase directly after the first super admin exists.

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| "Node.js is not installed" | Node wasn't installed, or PATH wasn't refreshed | Install Node LTS, reboot, retry |
| "Missing file: agent\config.json" | The `selfprint-agent.zip` wasn't fully extracted | Make sure you extracted the entire `selfprint-agent.zip` to the shop PC; the config is pre-filled inside |
| Agent runs but nothing prints | Wrong `fallbackPrinter` name | Re-check exact printer name in Windows Settings → Printers & scanners |
| Customers can't reach the site (Path B) | Wrong IP, firewall blocking, or phone not on same Wi-Fi | Recheck `ipconfig`, allow Node.js through Windows Firewall, confirm same network |
| Staff can't log in (Path B) | Local SQLite mode has no login by design | Expected — see `docs/LOCAL_DEV_AUTH.md`, or switch to Path A |
| Jobs stuck on "printing" | Agent crashed mid-job | Auto-reset after 10 minutes by the cleanup cron; or restart immediately via `schtasks /Run /TN SelfPrintAgent`, or reboot the PC |
