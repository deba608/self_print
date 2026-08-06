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
deployment (the actual website). Do this from your own laptop — only Step 2
happens on-site at the shop.

#### 1.1 Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in (or create a free account).
2. Click **New project**.
3. Choose your organisation, give the project a name (e.g. `selfprint`), set a
   strong database password (save it somewhere — you'll need it for migrations),
   and pick the region closest to the shop.
4. Click **Create new project** and wait ~2 minutes for it to provision.

#### 1.2 Get your API keys

1. In your new project, go to **Project Settings** (gear icon, bottom-left) →
   **API**.
2. Copy these four values — you'll paste them into Vercel in Step 1.4:
   - **Project URL** → used as both `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY`
     *(keep this secret — never expose it in the browser or commit it to git)*

#### 1.3 Run the database migrations

The migrations create all the tables (`jobs`, `job_files`, `staff_profiles`,
`agent_config`, `agent_update_events`, etc.).

**Option A — Supabase dashboard (no CLI needed):**
1. In your project, go to **SQL Editor** (left sidebar).
2. For each `.sql` file in `supabase/migrations/` (in filename order), paste
   the contents into the editor and click **Run**.

**Option B — Supabase CLI:**
```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

#### 1.4 Create a private Storage bucket

1. In Supabase, go to **Storage** (left sidebar) → **New bucket**.
2. Name: `selfprint` → **Private** (not public) → Create.
3. Create a second bucket: name `agent-updates` → **Private** → Create.
   This one holds the self-update zips.

#### 1.5 Deploy the web app to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in.
2. Click **Add New → Project** → Import your Git repository.
3. In **Environment Variables**, add all the keys from `.env.example`.
   At minimum:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | Your Supabase project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key (secret) |
   | `NEXT_PUBLIC_SUPABASE_URL` | Same as `SUPABASE_URL` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key |
   | `SESSION_SECRET` | Any random 32+ char string |
   | `AGENT_TOKEN` | Any random string (protects `/api/cleanup` in dev) |
   | `CRON_SECRET` | Any random string (protects the cleanup cron endpoint) |
   | `SHOP_NAME` | Your shop's name (shown on receipt) |
   | `NEXT_PUBLIC_SITE_URL` | Your Vercel deployment URL (e.g. `https://selfprint.vercel.app`) |

4. Click **Deploy**. Wait for the build to finish.
5. Open your Vercel URL — you should see the customer upload page.

#### 1.6 Create the first staff account (super admin)

There is no self-service sign-up for staff — the first account must be created
manually.

**Option A — Script (easiest):**
```powershell
node scripts/create-owner.mjs admin@yourshop.com YourPassword123
```
Run this from the project root with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
in your `.env` file. It creates the Supabase Auth user and the `staff_profiles`
row in one step.

**Option B — Supabase dashboard:**
1. Supabase → **Authentication** → **Users** → **Invite user** (enter email).
2. The user gets an email link; after they accept, go to **Table Editor** →
   `staff_profiles` → **Insert row**:
   - `id`: the user's UUID from the Authentication tab
   - `role`: `super_admin`
   - `name`: their display name

Once the super admin exists, they can invite more staff from `/admin/staff`
inside the dashboard — no more manual DB edits needed.

#### 1.7 Print the shop QR code

`docs/selfprint-shop-qr-a4.pdf` (or the `.html` beside it) is a printable A4
poster with the QR code pointing at the customer upload page. If your Vercel
URL differs from what's baked in, regenerate it — open the `.html` file in a
browser, update the URL, and print to PDF.

At this point the website is live and staff can log in. Nothing prints yet —
that's Step 2.

---

### Step 2 — Print agent on the shop PC (do this on-site)

This is the only part that lives at the shop, on the PC connected to the printer.

#### 2.1 Install Node.js

1. On the shop PC, open a browser and go to [nodejs.org](https://nodejs.org).
2. Download the **LTS** version (the left button — not "Current").
3. Run the installer. Click Next → Next → Next → Install → Finish.
   All defaults are fine.
4. Open **PowerShell** (Start → search "PowerShell") and verify:
   ```powershell
   node --version
   ```
   Should print something like `v20.x.x`. If it says "not recognised", reboot
   and try again.

#### 2.2 Build and send the agent package (developer step)

On your **developer machine** (not the shop PC):

1. Fill in `agent/config.json` with the shop's real Supabase credentials:
   ```json
   {
     "supabaseUrl": "https://your-project.supabase.co",
     "supabaseKey": "your-service-role-key",
     "fallbackPrinter": "",
     "updateMode": "manual",
     "tempDir": "./agent-temp",
     "maxRetries": 3
   }
   ```
2. Run:
   ```powershell
   npm run package:shop
   ```
   This produces `dist-shop-package/selfprint-agent.zip` (~100 MB, includes
   pre-built `node_modules` so the shop PC needs no npm install).

3. Send the zip to the shop PC. Recommended methods:
   - **WhatsApp / Telegram** — easiest for most clients
   - **Google Drive / OneDrive** — good for large files; share a download link
   - **USB drive** — if the shop PC has no internet yet

#### 2.3 Extract the zip on the shop PC

1. Copy `selfprint-agent.zip` to the shop PC.
2. Right-click → **Extract All** → choose a location (e.g. `C:\SelfPrint`).
3. After extraction you should see:
   ```
   C:\SelfPrint\
   ├── SETUP.bat
   ├── TEST-PRINTER.bat
   ├── README.txt
   └── engine\
       ├── agent\
       │   ├── config.json    ← pre-filled, don't edit
       │   └── SETUP.bat
       └── node_modules\
   ```
4. **Security**: delete the original `.zip` from Downloads — it contains a
   live Supabase service-role key inside `agent\config.json`.

#### 2.4 Run SETUP.bat

1. Double-click **`SETUP.bat`** (at the top level of the extracted folder,
   not the one inside `engine\agent\`).
2. If Windows shows a "Do you want to allow this app to make changes?" prompt,
   click **Yes**.
3. The script:
   - Checks Node.js is installed
   - Registers a Windows Scheduled Task called **SelfPrintAgent** that starts
     automatically on every boot (even without login, if the task is set to
     run whether or not a user is logged in)
   - Registers a second task **SelfPrintUpdater** (dormant — only fires during
     updates)
   - Starts the agent immediately
4. When you see **DONE!**, the agent is running. No window needs to stay open.

   To confirm it's running, open Task Scheduler (Start → search "Task
   Scheduler") → **Task Scheduler Library** → find "SelfPrintAgent" →
   Status should say **Running**.

#### 2.5 Set printer in the admin dashboard

1. Log in to `/admin` as super admin.
2. Go to the **Printer** panel.
3. Under "B/W printer" and "Color printer", pick the printer names that appear
   in the dropdown (these come from the agent reporting what's installed on the
   shop PC). If the dropdowns are empty, wait 60 seconds and refresh — the
   agent reports printers once per minute.

#### 2.6 Test end-to-end

1. Scan the shop QR code on your phone (or open the Vercel URL).
2. Upload a test PDF and submit.
3. Log in to `/admin`, find the job, approve it.
4. Confirm it prints.

Alternatively, double-click **`TEST-PRINTER.bat`** to send a one-off Windows
test page directly to the default printer — useful for checking the hardware
connection without going through the full upload flow.

**Optional — DOC/DOCX support**: install **LibreOffice** on the shop PC (any
recent version) to enable `.docx` → PDF conversion. After installing, point
`LIBREOFFICE_PATH` in `.env` at `soffice.exe` if it's not in the default
install location. Skip this if PDF-only is fine.

---

## Path B: Fully local (single offline PC)

Use this only if the shop has no reliable internet, or you specifically want
everything on one machine with no cloud dependency. The customer's phone
still needs to be on the shop's own Wi-Fi to reach this PC.

### Step 1 — Install Node.js

Same as Path A Step 2.1.

### Step 2 — Get the full project onto the shop PC

Option A — USB drive: copy the entire project folder.
Option B — `git clone` if Node + Git are installed:
```powershell
git clone https://github.com/YOUR_ORG/selfprint.git C:\SelfPrint
cd C:\SelfPrint
```

### Step 3 — Install dependencies and seed the database

```powershell
cd C:\SelfPrint
npm install
npm run db:seed
```

### Step 4 — Create a .env file

Copy `.env.example` to `.env` and set at minimum:
```
AGENT_TOKEN=some-long-random-secret
SESSION_SECRET=another-long-random-secret
SHOP_NAME=My Print Shop
```

Leave all `SUPABASE_*` variables blank — that tells the app to use local
SQLite instead of the cloud.

Note: in local SQLite mode there is no staff login. The admin dashboard is
only protected by being on the shop's own local network. See
`docs/LOCAL_DEV_AUTH.md` for details.

### Step 5 — Find the PC's local IP address

```powershell
ipconfig
```

Look for `IPv4 Address` under your active Wi-Fi or Ethernet adapter, e.g.
`192.168.1.42`. Write this down — customers use it to reach the upload page.

### Step 6 — Build and start the web app

```powershell
npm run build
npm run start
```

The app serves on port 3000. Customers on the shop Wi-Fi reach it at
`http://192.168.1.42:3000` (use your actual IP).

To keep the web app running after a reboot, use Windows Task Scheduler to
auto-start `npm run start`, or use [PM2](https://pm2.keymetrics.io/):
```powershell
npm install -g pm2
pm2 start "npm run start" --name selfprint-web --cwd "C:\SelfPrint"
pm2 save && pm2 startup
```

Windows Firewall may prompt to allow Node.js — allow it on Private networks
so phones on the shop Wi-Fi can connect.

### Step 7 — Print the QR code

Regenerate `docs/selfprint-shop-qr-a4.pdf` with the shop's local IP baked in
(the default points at the production Vercel URL). Open
`docs/selfprint-shop-qr-a4.html` in a browser, update the URL to
`http://192.168.1.42:3000`, print to PDF, and print/laminate the A4 sheet.

### Step 8 — Set up the print agent

Same as Path A Steps 2.2–2.6, except `agent/config.json` doesn't need
Supabase credentials — the agent in local SQLite mode reads from the local
database. Confirm with whoever set this up whether the agent needs adjusting
for your specific local configuration (the agent as shipped talks to Supabase
directly; if you're fully local without Supabase, agent functionality may be
limited).

---

## Day-to-day operation (either path)

- **Printer service**: runs hidden in the background as the "SelfPrintAgent"
  Windows Scheduled Task — no window appears after setup. If printing stops,
  check `engine\agent\agent.log` for error messages. To restart manually:
  ```powershell
  schtasks /Run /TN SelfPrintAgent
  ```
  Or simply reboot the PC.

- **Updates**: nothing to do on the shop PC. When the developer publishes a
  new agent version and clicks **Install** in the admin dashboard, the agent
  downloads and applies the update itself in the background (never while a job
  is printing) and restarts automatically. If the new version doesn't start
  cleanly, the PC rolls back to the previous version on its own — no manual
  intervention. Full details: [`docs/AGENT_SELF_UPDATE.md`](AGENT_SELF_UPDATE.md).

- **Cleanup**: `npm run cleanup` removes finished/expired jobs and their files.
  Schedule this automatically:
  - Path A: add a Vercel Cron Job calling `GET /api/cleanup` with the
    `Authorization: Bearer <CRON_SECRET>` header, once per day.
  - Path B: Task Scheduler → run `npm run cleanup` in `C:\SelfPrint` daily.

- **Adding staff**: existing super admins invite more from `/admin/staff` — no
  need to touch Supabase directly after the first super admin exists.

- **Changing the printer**: log in to `/admin` → Printer panel → update the
  B/W and/or Color printer dropdowns. The agent picks up the change within 30s
  — no restart needed.

---

## Troubleshooting quick reference

| Symptom | Likely cause | Fix |
|---|---|---|
| "Node.js is not installed" | Node wasn't installed, or PATH wasn't refreshed after install | Install Node LTS from nodejs.org, reboot, retry SETUP.bat |
| "Missing file: agent\config.json" | Zip wasn't fully extracted, or wrong folder | Make sure you extracted the entire zip; the config is pre-filled inside `engine\agent\config.json` |
| SETUP.bat closes immediately with an error | Script blocked by antivirus, or extracted to a read-only folder | Try extracting to `C:\SelfPrint` and right-click → "Run as administrator" |
| Agent runs but nothing prints | No printer set in dashboard, or wrong printer name | Log in to `/admin` → Printer panel; check printer name matches exactly what Windows shows |
| Printer dropdown in admin is empty | Agent not yet connected, or not reporting printers | Wait 60s and refresh; check `agent.log` for connection errors |
| Customers can't reach the site (Path B) | Wrong IP in QR, firewall blocking, or phone not on same Wi-Fi | Recheck `ipconfig`, allow Node.js through Windows Firewall (Private networks), confirm same Wi-Fi |
| Staff can't log in (Path B) | Local SQLite mode has no login by design | Expected — see `docs/LOCAL_DEV_AUTH.md`, or switch to Path A |
| Jobs stuck on "printing" | Agent crashed mid-job | Auto-reset after 10 minutes by the cleanup cron; restart via `schtasks /Run /TN SelfPrintAgent` or reboot |
| Dashboard shows "Updating…" forever | Update stuck — agent not running or internet down | Check Task Scheduler for "SelfPrintAgent"; run SETUP.bat again if missing; see `docs/AGENT_SELF_UPDATE.md` for full troubleshooting |
| DOC/DOCX files not converting | LibreOffice not installed | Install LibreOffice from libreoffice.org; set `LIBREOFFICE_PATH` in `.env` if needed |
