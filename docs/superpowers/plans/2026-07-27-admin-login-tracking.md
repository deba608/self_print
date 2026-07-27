# Admin Login Device Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every admin login attempt with device + location details and surface the data in a per-staff expandable view and a new `/admin/security` audit page.

**Architecture:** A new `admin_login_events` Supabase table stores one row per login attempt. The existing `/api/admin/login` route is extended to parse the User-Agent string (no external dependency) and do a non-blocking IP geolocation lookup before inserting the event row. Two UI surfaces read from a new `GET /api/admin/login-events` route: an expandable panel per staff member (Staff page) and a full audit table (new Security page).

**Tech Stack:** Next.js 15, TypeScript, Supabase (service role client via `createAdminClient()`), Vitest for tests, lucide-react icons, existing CSS variable system.

## Global Constraints

- No new npm packages — UA parsing via regex, geolocation via native `fetch`.
- Service role client for all `admin_login_events` queries: import `createAdminClient` from `@/lib/supabase/admin`.
- Geo lookup uses `https://ip-api.com/json/{ip}?fields=city,country,status` — 1.5 s timeout, returns `null`/`null` on any failure.
- Private IPs (`127.x`, `10.x`, `192.168.x`, `172.16-31.x`, `::1`, `unknown`) skip geo lookup.
- Retention: last 50 rows per `staff_id`, trimmed app-side after insert.
- Security page and per-staff login history visible to `super_admin` role only.
- CSS classes follow existing BEM-like convention in `src/app/admin/management.css`.
- Run tests with: `npx vitest run`

---

### Task 1: DB Migration — `admin_login_events` table

**Files:**
- Create: `supabase/migrations/20260727100000_admin_login_events.sql`
- Apply directly via Supabase MCP (`mcp__supabase__execute_sql`)

**Interfaces:**
- Produces: `admin_login_events` table accessible to `service_role`

- [ ] **Step 1: Write migration file**

Create `supabase/migrations/20260727100000_admin_login_events.sql`:

```sql
create table if not exists public.admin_login_events (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid references auth.users(id) on delete set null,
  email          text not null,
  ip             text,
  user_agent     text,
  browser        text,
  os             text,
  device         text,
  city           text,
  country        text,
  success        boolean not null,
  failure_reason text,
  logged_at      timestamptz not null default now()
);

grant all on public.admin_login_events to service_role;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__execute_sql` with the exact SQL above.

- [ ] **Step 3: Verify table exists**

Run via `mcp__supabase__execute_sql`:
```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'admin_login_events'
order by ordinal_position;
```
Expected: 13 rows listing all columns.

- [ ] **Step 4: Commit migration file**

```bash
git add supabase/migrations/20260727100000_admin_login_events.sql
git commit -m "feat: add admin_login_events table migration"
```

---

### Task 2: `LoginEvent` type + UA parser (with tests)

**Files:**
- Modify: `src/lib/types.ts`
- Create: `src/lib/ua-parser.ts`
- Create: `src/lib/ua-parser.test.ts`

**Interfaces:**
- Produces: `LoginEvent` type (used by Task 5, 6, 7)
- Produces: `parseUA(ua: string | null): ParsedUA` (used by Task 4)

- [ ] **Step 1: Add `LoginEvent` and `ParsedUA` types to `src/lib/types.ts`**

Append to the end of `src/lib/types.ts`:

```ts
export type ParsedUA = {
  browser: string;
  os: string;
  device: string;
};

export type LoginEvent = {
  id: string;
  staffId: string | null;
  email: string;
  ip: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  city: string | null;
  country: string | null;
  success: boolean;
  failureReason: string | null;
  loggedAt: string;
};
```

- [ ] **Step 2: Write failing tests in `src/lib/ua-parser.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseUA } from "./ua-parser";

describe("parseUA", () => {
  it("returns Unknown for null input", () => {
    expect(parseUA(null)).toEqual({ browser: "Unknown", os: "Unknown", device: "Desktop" });
  });

  it("detects Chrome on Windows 10/11", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
    expect(parseUA(ua)).toEqual({ browser: "Chrome 125", os: "Windows 10/11", device: "Desktop" });
  });

  it("detects Edge (not Chrome) on Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
    expect(parseUA(ua)).toEqual({ browser: "Edge 124", os: "Windows 10/11", device: "Desktop" });
  });

  it("detects Firefox on Linux", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0";
    expect(parseUA(ua)).toEqual({ browser: "Firefox 126", os: "Linux", device: "Desktop" });
  });

  it("detects Safari on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15";
    expect(parseUA(ua)).toEqual({ browser: "Safari 17", os: "macOS 14.4.1", device: "Desktop" });
  });

  it("detects Mobile on Android phone", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
    expect(parseUA(ua)).toEqual({ browser: "Chrome 125", os: "Android 14", device: "Mobile" });
  });

  it("detects Tablet on iPad", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    const result = parseUA(ua);
    expect(result.device).toBe("Tablet");
  });

  it("detects Opera", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0";
    expect(parseUA(ua).browser).toBe("Opera 111");
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npx vitest run src/lib/ua-parser.test.ts
```
Expected: `Cannot find module './ua-parser'`

- [ ] **Step 4: Implement `src/lib/ua-parser.ts`**

```ts
import type { ParsedUA } from "./types";

export function parseUA(ua: string | null): ParsedUA {
  if (!ua) return { browser: "Unknown", os: "Unknown", device: "Desktop" };

  // Device — check tablet before mobile (iPad UA contains "Mobile")
  const isTablet =
    /iPad/i.test(ua) ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile = !isTablet && /Mobi|Android|iPhone|iPod/i.test(ua);
  const device = isTablet ? "Tablet" : isMobile ? "Mobile" : "Desktop";

  // Browser — check Edge and Opera first; both embed "Chrome/" token
  let browser = "Unknown";
  const edgeMatch = ua.match(/Edg\/(\d+)/);
  const oprMatch = ua.match(/OPR\/(\d+)/);
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  const safariMatch = ua.match(/Version\/(\d+)[^)]*Safari/);
  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (oprMatch) browser = `Opera ${oprMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`;

  // OS
  let os = "Unknown";
  const winMatch = ua.match(/Windows NT (\d+\.\d+)/);
  const macMatch = ua.match(/Mac OS X ([\d_]+)/);
  const androidMatch = ua.match(/Android (\d+)/);
  const iosMatch = ua.match(/(?:iPhone|iPad)(?: Simulator)? OS ([\d_]+)/i);

  if (winMatch) {
    const nt = winMatch[1];
    if (nt === "10.0") os = "Windows 10/11";
    else if (nt === "6.3") os = "Windows 8.1";
    else if (nt === "6.2") os = "Windows 8";
    else if (nt === "6.1") os = "Windows 7";
    else os = "Windows";
  } else if (androidMatch) {
    os = `Android ${androidMatch[1]}`;
  } else if (iosMatch) {
    os = `iOS ${iosMatch[1].replace(/_/g, ".")}`;
  } else if (macMatch) {
    os = `macOS ${macMatch[1].replace(/_/g, ".")}`;
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  return { browser, os, device };
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run src/lib/ua-parser.test.ts
```
Expected: all 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/ua-parser.ts src/lib/ua-parser.test.ts
git commit -m "feat: add LoginEvent type and UA parser"
```

---

### Task 3: IP Geolocation util

**Files:**
- Create: `src/lib/geo.ts`

**Interfaces:**
- Produces: `geoLookup(ip: string): Promise<{ city: string | null; country: string | null }>` (used by Task 4)

- [ ] **Step 1: Create `src/lib/geo.ts`**

```ts
const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/;

export type GeoResult = { city: string | null; country: string | null };

export async function geoLookup(ip: string): Promise<GeoResult> {
  const empty: GeoResult = { city: null, country: null };
  if (!ip || ip === "unknown" || PRIVATE_IP.test(ip)) return empty;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(
      `https://ip-api.com/json/${ip}?fields=status,city,country`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return empty;
    const data: { status: string; city?: string; country?: string } =
      await res.json();
    if (data.status !== "success") return empty;
    return { city: data.city ?? null, country: data.country ?? null };
  } catch {
    return empty;
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```
Expected: no errors related to `geo.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/geo.ts
git commit -m "feat: add IP geolocation util with private-IP guard and timeout"
```

---

### Task 4: Extend admin login route to log events

**Files:**
- Modify: `src/app/api/admin/login/route.ts`

**Interfaces:**
- Consumes: `parseUA` from `@/lib/ua-parser`, `geoLookup` from `@/lib/geo`, `createAdminClient` from `@/lib/supabase/admin`, `clientIp` from `@/lib/ratelimit`

- [ ] **Step 1: Replace `src/app/api/admin/login/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, isRateLimited } from "@/lib/ratelimit";
import { parseUA } from "@/lib/ua-parser";
import { geoLookup } from "@/lib/geo";

type EventPayload = {
  staffId: string | null;
  email: string;
  ip: string;
  userAgent: string | null;
  browser: string;
  os: string;
  device: string;
  success: boolean;
  failureReason: string | null;
};

// Fire-and-forget: geo lookup + insert. Never throws.
async function logLoginEvent(payload: EventPayload): Promise<void> {
  try {
    const { city, country } = await geoLookup(payload.ip);
    const admin = createAdminClient();

    const { data: inserted, error: insertError } = await admin
      .from("admin_login_events")
      .insert({
        staff_id: payload.staffId,
        email: payload.email,
        ip: payload.ip,
        user_agent: payload.userAgent,
        browser: payload.browser,
        os: payload.os,
        device: payload.device,
        city,
        country,
        success: payload.success,
        failure_reason: payload.failureReason,
      })
      .select("id")
      .single();

    if (insertError || !inserted || !payload.staffId) return;

    // Trim to 50 most-recent rows for this staff member
    const { data: toKeep } = await admin
      .from("admin_login_events")
      .select("id")
      .eq("staff_id", payload.staffId)
      .order("logged_at", { ascending: false })
      .limit(50);

    if (toKeep && toKeep.length === 50) {
      const keepIds = toKeep.map((r: { id: string }) => r.id);
      await admin
        .from("admin_login_events")
        .delete()
        .eq("staff_id", payload.staffId)
        .not("id", "in", `(${keepIds.join(",")})`);
    }
  } catch {
    // Never let logging crash the login flow
  }
}

export async function POST(request: NextRequest) {
  if (isRateLimited("admin-login", clientIp(request.headers), 8, 60 * 1000)) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const ip = clientIp(request.headers);
  const userAgent = request.headers.get("user-agent") ?? null;
  const { browser, os, device } = parseUA(userAgent);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    void logLoginEvent({
      staffId: null,
      email,
      ip,
      userAgent,
      browser,
      os,
      device,
      success: false,
      failureReason: "invalid_credentials",
    });
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("staff_profiles")
    .select("id")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    await supabase.auth.signOut();
    void logLoginEvent({
      staffId: data.user.id,
      email,
      ip,
      userAgent,
      browser,
      os,
      device,
      success: false,
      failureReason: "not_staff",
    });
    return NextResponse.json(
      { error: "This account does not have admin access" },
      { status: 403 }
    );
  }

  void logLoginEvent({
    staffId: data.user.id,
    email,
    ip,
    userAgent,
    browser,
    os,
    device,
    success: true,
    failureReason: null,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Smoke test by logging in as admin in the browser**

Start dev server (`npm run dev`), log in at `/admin`. Check Supabase `admin_login_events` table via MCP:
```sql
select id, email, browser, os, device, city, country, success, logged_at
from admin_login_events
order by logged_at desc
limit 5;
```
Expected: one row with correct browser/OS, success = true.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/login/route.ts
git commit -m "feat: log device + location on every admin login attempt"
```

---

### Task 5: `GET /api/admin/login-events` API route

**Files:**
- Create: `src/app/api/admin/login-events/route.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/security`, `createAdminClient` from `@/lib/supabase/admin`
- Produces: `LoginEvent[]` JSON (used by Task 6 and Task 7)

- [ ] **Step 1: Create `src/app/api/admin/login-events/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LoginEvent } from "@/lib/types";

function mapRow(row: any): LoginEvent {
  return {
    id: row.id,
    staffId: row.staff_id ?? null,
    email: row.email,
    ip: row.ip ?? null,
    browser: row.browser ?? null,
    os: row.os ?? null,
    device: row.device ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    success: row.success,
    failureReason: row.failure_reason ?? null,
    loggedAt: row.logged_at,
  };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  if (admin.role !== "super_admin") {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const staffId = searchParams.get("staffId");

  const client = createAdminClient();

  if (staffId) {
    const { data, error } = await client
      .from("admin_login_events")
      .select("*")
      .eq("staff_id", staffId)
      .order("logged_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
    }
    return NextResponse.json((data ?? []).map(mapRow));
  }

  // All staff — last 200 events across all
  const { data, error } = await client
    .from("admin_login_events")
    .select("*")
    .order("logged_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
  }
  return NextResponse.json((data ?? []).map(mapRow));
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Test the route in the browser dev tools or curl**

With dev server running, visit `/api/admin/login-events` in the browser (while logged in as super_admin).
Expected: JSON array with login event objects.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/login-events/route.ts
git commit -m "feat: add GET /api/admin/login-events route"
```

---

### Task 6: Security audit page

**Files:**
- Create: `src/components/SecurityPage.tsx`
- Create: `src/app/admin/security/page.tsx`
- Modify: `src/app/admin/management.css` (append new styles)

**Interfaces:**
- Consumes: `LoginEvent` from `@/lib/types`, `GET /api/admin/login-events`

- [ ] **Step 1: Create `src/components/SecurityPage.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Monitor,
  ShieldCheck,
  Smartphone,
  Tablet,
  XCircle,
} from "lucide-react";
import type { LoginEvent, StaffProfile } from "@/lib/types";
import AdminManagementNav from "./AdminManagementNav";

function DeviceIcon({ device }: { device: string | null }) {
  if (device === "Mobile") return <Smartphone size={14} aria-hidden="true" />;
  if (device === "Tablet") return <Tablet size={14} aria-hidden="true" />;
  return <Monitor size={14} aria-hidden="true" />;
}

function formatEventDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LocationCell({ city, country }: { city: string | null; country: string | null }) {
  if (!city && !country) return <span className="login-event-muted">—</span>;
  return <span>{[city, country].filter(Boolean).join(", ")}</span>;
}

function StatusCell({ success, failureReason }: { success: boolean; failureReason: string | null }) {
  if (success) {
    return (
      <span className="login-status login-status--success">
        <CheckCircle2 size={13} aria-hidden="true" />
        Success
      </span>
    );
  }
  const label =
    failureReason === "invalid_credentials"
      ? "Wrong password"
      : failureReason === "not_staff"
      ? "Not staff"
      : "Failed";
  return (
    <span className="login-status login-status--fail" title={failureReason ?? undefined}>
      <XCircle size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

function SecurityTable({ events }: { events: LoginEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="security-empty">
        <ShieldCheck size={28} aria-hidden="true" />
        <p>No login events recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="security-table-wrap">
      <table className="security-table">
        <thead>
          <tr>
            <th>Staff</th>
            <th>Date / Time</th>
            <th>IP</th>
            <th>Browser</th>
            <th>OS</th>
            <th>Device</th>
            <th>Location</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id}>
              <td className="security-email-cell">{ev.email}</td>
              <td className="security-date-cell">{formatEventDate(ev.loggedAt)}</td>
              <td className="login-event-mono">{ev.ip ?? "—"}</td>
              <td>{ev.browser ?? "—"}</td>
              <td>{ev.os ?? "—"}</td>
              <td className="security-device-cell">
                <DeviceIcon device={ev.device} />
                {ev.device ?? "—"}
              </td>
              <td><LocationCell city={ev.city} country={ev.country} /></td>
              <td><StatusCell success={ev.success} failureReason={ev.failureReason} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SecurityPage() {
  const [authState, setAuthState] = useState<"checking" | "ok" | "unauthorized" | "forbidden">("checking");
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/me", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) { setAuthState("unauthorized"); return; }
        const profile: StaffProfile = await res.json();
        if (profile.role !== "super_admin") { setAuthState("forbidden"); return; }
        setAuthState("ok");

        // Load events
        setLoading(true);
        fetch("/api/admin/login-events", { credentials: "include" })
          .then(async (evRes) => {
            if (!evRes.ok) throw new Error("Failed to load events");
            setEvents(await evRes.json());
          })
          .catch((err) => setError(err.message))
          .finally(() => setLoading(false));
      })
      .catch(() => setAuthState("unauthorized"));
  }, []);

  return (
    <div className="management-page-shell">
      <AdminManagementNav />
      <main className="admin-shell accounts-shell">
        {authState === "checking" ? (
          <div className="staff-page-loading" role="status">
            <Loader2 size={24} className="spin" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        ) : authState === "unauthorized" ? (
          <div className="accounts-locked">
            <Lock size={28} aria-hidden="true" />
            <p>Your admin session has expired.</p>
            <Link href="/admin" className="btn-primary">Log in again</Link>
          </div>
        ) : authState === "forbidden" ? (
          <div className="accounts-locked">
            <Lock size={28} aria-hidden="true" />
            <p>Only owners can view security logs.</p>
            <Link href="/admin" className="btn-primary">Back to dashboard</Link>
          </div>
        ) : (
          <div className="security-page">
            <header className="staff-hero">
              <div className="staff-hero-copy">
                <span className="staff-eyebrow">Audit trail</span>
                <h1>Security log</h1>
                <p>All admin login attempts — device, location, and outcome.</p>
              </div>
            </header>

            {loading ? (
              <div className="staff-page-loading" role="status">
                <Loader2 size={24} className="spin" aria-hidden="true" />
                <span>Loading login events…</span>
              </div>
            ) : error ? (
              <div className="staff-message error">
                <AlertCircle size={17} aria-hidden="true" />
                {error}
              </div>
            ) : (
              <SecurityTable events={events} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/admin/security/page.tsx`**

```tsx
import SecurityPage from "@/components/SecurityPage";

export default function Page() {
  return <SecurityPage />;
}
```

- [ ] **Step 3: Append styles to `src/app/admin/management.css`**

Append to the end of the file:

```css
/* ── Security / Login Events ─────────────────────────────────── */

.security-page {
  width: min(1200px, calc(100% - 32px));
  margin: 0 auto;
  padding-bottom: 48px;
}

.security-table-wrap {
  overflow-x: auto;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: var(--panel);
}

.security-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}

.security-table th {
  text-align: left;
  padding: 10px 14px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
  background: var(--accent-bg);
}

.security-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
  white-space: nowrap;
}

.security-table tbody tr:last-child td { border-bottom: none; }

.security-table tbody tr:hover { background: var(--accent-bg); }

.security-email-cell { font-weight: 500; }

.security-date-cell { color: var(--muted); font-size: 13px; }

.security-device-cell {
  display: flex;
  align-items: center;
  gap: 5px;
}

.login-event-mono {
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  color: var(--muted);
}

.login-event-muted { color: var(--muted); }

.login-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
}

.login-status--success {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}

.login-status--fail {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.security-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 24px;
  color: var(--muted);
  text-align: center;
}

/* Per-staff login history (expandable in StaffManagement) */

.staff-login-history {
  border-top: 1px solid var(--line);
  padding: 12px 16px 0;
  margin-top: 4px;
}

.staff-login-history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin-top: 8px;
}

.staff-login-history-table th {
  text-align: left;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}

.staff-login-history-table td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}

.staff-login-history-table tbody tr:last-child td { border-bottom: none; }

.staff-login-history-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  color: var(--muted);
  font-size: 13px;
}

.staff-history-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin-top: 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-full);
  background: none;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.staff-history-toggle:hover {
  background: var(--accent-bg);
  color: var(--accent);
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SecurityPage.tsx src/app/admin/security/page.tsx src/app/admin/management.css
git commit -m "feat: add security audit page with full login event table"
```

---

### Task 7: Nav Security link + Staff expandable login history

**Files:**
- Modify: `src/components/AdminManagementNav.tsx`
- Modify: `src/components/StaffManagement.tsx`

**Interfaces:**
- Consumes: `LoginEvent` from `@/lib/types`, `GET /api/admin/login-events?staffId=X`

- [ ] **Step 1: Add Security link to `src/components/AdminManagementNav.tsx`**

The nav currently has no role awareness. Add a `role` prop so callers can pass it; fall back to showing the link for everyone (the Security page gates access itself). Since all pages that use the nav don't currently pass role, the cleanest approach is to fetch `/api/admin/me` inside the nav only for the Security link visibility. Instead of that complexity, just add the link unconditionally — the page itself redirects non-super_admins.

Replace the import block and `managementLinks` const:

```tsx
import {
  BarChart3,
  LayoutDashboard,
  ListTodo,
  Loader2,
  LogOut,
  Printer,
  ShieldCheck,
  UsersRound,
  UserRoundCog,
} from "lucide-react";

const managementLinks = [
  { href: "/admin/orders", label: "Orders", icon: ListTodo },
  { href: "/admin/customers", label: "Customers", icon: UsersRound },
  { href: "/admin/accounts", label: "Accounts", icon: BarChart3 },
  { href: "/admin/staff", label: "Staff", icon: UserRoundCog },
  { href: "/admin/security", label: "Security", icon: ShieldCheck },
] as const;
```

- [ ] **Step 2: Add expandable login history to `src/components/StaffManagement.tsx`**

Add these imports at the top (merge with existing imports):

```tsx
import {
  // ... existing imports ...
  ChevronDown,
  ChevronUp,
  Monitor,
  Smartphone,
  Tablet,
  XCircle,
} from "lucide-react";
import type { LoginEvent } from "@/lib/types";
```

Add a `LoginHistoryPanel` component just before the `export default` line:

```tsx
function formatEventDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeviceIcon({ device }: { device: string | null }) {
  if (device === "Mobile") return <Smartphone size={13} aria-hidden="true" />;
  if (device === "Tablet") return <Tablet size={13} aria-hidden="true" />;
  return <Monitor size={13} aria-hidden="true" />;
}

function LoginHistoryPanel({ staffId }: { staffId: string }) {
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/admin/login-events?staffId=${staffId}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load");
        setEvents(await res.json());
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [staffId]);

  if (loading) {
    return (
      <div className="staff-login-history-loading">
        <Loader2 size={14} className="spin" aria-hidden="true" />
        Loading login history…
      </div>
    );
  }

  if (error) {
    return <p style={{ color: "var(--error, #dc2626)", fontSize: 13 }}>{error}</p>;
  }

  if (!events || events.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13 }}>No login events yet.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="staff-login-history-table">
        <thead>
          <tr>
            <th>Date / Time</th>
            <th>IP</th>
            <th>Browser</th>
            <th>OS</th>
            <th>Device</th>
            <th>Location</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id}>
              <td className="security-date-cell">{formatEventDate(ev.loggedAt)}</td>
              <td className="login-event-mono">{ev.ip ?? "—"}</td>
              <td>{ev.browser ?? "—"}</td>
              <td>{ev.os ?? "—"}</td>
              <td className="security-device-cell">
                <DeviceIcon device={ev.device} />
                {ev.device ?? "—"}
              </td>
              <td>
                {ev.city || ev.country
                  ? [ev.city, ev.country].filter(Boolean).join(", ")
                  : <span className="login-event-muted">—</span>}
              </td>
              <td>
                {ev.success ? (
                  <span className="login-status login-status--success">
                    <CheckCircle2 size={12} aria-hidden="true" /> Success
                  </span>
                ) : (
                  <span className="login-status login-status--fail">
                    <XCircle size={12} aria-hidden="true" />
                    {ev.failureReason === "invalid_credentials"
                      ? "Wrong password"
                      : ev.failureReason === "not_staff"
                      ? "Not staff"
                      : "Failed"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Then inside the staff member `<li>` in `StaffManagement`, add state and toggle. At the top of `StaffManagement` component, add:

```tsx
const [expandedLoginId, setExpandedLoginId] = useState<string | null>(null);
```

Inside the `staff.map((member) => { ... })` block, add the toggle button and panel **inside the `<li>`**, just after the closing `</div>` of `staff-member-actions`:

```tsx
{isSuperAdmin && (
  <div style={{ width: "100%" }}>
    <button
      type="button"
      className="staff-history-toggle"
      onClick={() =>
        setExpandedLoginId(expandedLoginId === member.id ? null : member.id)
      }
      aria-expanded={expandedLoginId === member.id}
    >
      {expandedLoginId === member.id ? (
        <ChevronUp size={13} aria-hidden="true" />
      ) : (
        <ChevronDown size={13} aria-hidden="true" />
      )}
      {expandedLoginId === member.id ? "Hide" : "Login history"}
    </button>

    {expandedLoginId === member.id && (
      <div className="staff-login-history">
        <LoginHistoryPanel staffId={member.id} />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 5: Start dev server and verify in browser**

```bash
npm run dev
```

Check:
1. `/admin/staff` — each staff card shows "Login history" toggle; clicking it loads events.
2. `/admin/security` — full table visible when logged in as super_admin; redirects to `/admin` when logged in as regular admin.
3. Nav has "Security" link.
4. Login as admin → new row appears in `admin_login_events` within seconds.

- [ ] **Step 6: Commit**

```bash
git add src/components/AdminManagementNav.tsx src/components/StaffManagement.tsx
git commit -m "feat: add Security nav link and per-staff login history toggle"
```

---

## Self-Review

**Spec coverage check:**
- ✅ DB table with all 13 columns including city/country
- ✅ Grants to service_role
- ✅ UA parsing (browser, OS, device) — regex, no dependency
- ✅ Geo lookup — 1.5 s timeout, private IP guard
- ✅ Login route extended — both success and failure logged
- ✅ failure_reason: "invalid_credentials" | "not_staff"
- ✅ Retention: trim to 50 per staff after insert
- ✅ GET /api/admin/login-events — staffId param + all-staff mode
- ✅ super_admin gate on API route
- ✅ /admin/staff expandable login history (super_admin only)
- ✅ /admin/security full audit page
- ✅ Security link in nav
- ✅ CSS styles for both surfaces

**Type consistency:**
- `LoginEvent` defined in Task 2, consumed in Tasks 5, 6, 7 — matches.
- `parseUA` returns `ParsedUA` (browser/os/device strings) — used as-is in Task 4.
- `geoLookup` returns `{ city, country }` — used as-is in Task 4.
- `createAdminClient()` from `@/lib/supabase/admin` — verified export signature matches usage.

**No placeholders** — all steps contain actual code.
