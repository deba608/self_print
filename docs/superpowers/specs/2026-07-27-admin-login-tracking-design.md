# Admin Login Device Tracking — Design Spec

**Date:** 2026-07-27  
**Status:** Approved

## Overview

Log every admin login attempt (success and failure) with full device details — browser, OS, device type, IP, geolocation — and surface the data in two places: an expandable per-staff view on the existing Staff page, and a new Security audit page visible to super_admins only.

---

## Database

### New table: `admin_login_events`

```sql
CREATE TABLE admin_login_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email          text NOT NULL,
  ip             text,
  user_agent     text,
  browser        text,          -- e.g. "Chrome 125"
  os             text,          -- e.g. "Windows 11"
  device         text,          -- "Desktop" | "Mobile" | "Tablet"
  city           text,          -- from IP geolocation, nullable
  country        text,          -- from IP geolocation, nullable
  success        boolean NOT NULL,
  failure_reason text,          -- "invalid_credentials" | "not_staff" | null on success
  logged_at      timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON admin_login_events TO service_role;
```

### Retention

Last 50 rows per `staff_id`, enforced app-side after every insert:

```sql
DELETE FROM admin_login_events
WHERE staff_id = $1
  AND id NOT IN (
    SELECT id FROM admin_login_events
    WHERE staff_id = $1
    ORDER BY logged_at DESC
    LIMIT 50
  );
```

For failed attempts where `staff_id` is NULL (email not found in auth), retention is skipped — those rows are naturally sparse.

---

## UA Parsing

New file: `src/lib/ua-parser.ts`  
No npm dependency — regex-based.

```ts
export type ParsedUA = {
  browser: string;  // "Chrome 125" | "Firefox 126" | "Safari 17" | "Edge 124" | "Unknown"
  os: string;       // "Windows 11" | "macOS 14" | "Android 14" | "iOS 17" | "Linux" | "Unknown"
  device: string;   // "Mobile" | "Tablet" | "Desktop"
};

export function parseUA(ua: string | null): ParsedUA { ... }
```

Detection rules:
- **Browser:** match `Edg/`, `OPR/`, `Chrome/`, `Firefox/`, `Safari/` in order (Edge/Opera share Chrome token, so check first). Extract major version.
- **OS:** match `Windows NT`, `Mac OS X`, `Android`, `iPhone OS`, `iPad`, `Linux` — map NT versions to Windows release names (10.0→10/11 heuristic: build not available from UA, report "Windows 10/11").
- **Device:** `Mobile` if `Mobi` in UA and not tablet; `Tablet` if `iPad` or `Android` without `Mobile`; otherwise `Desktop`.

---

## IP Geolocation

Service: `https://ip-api.com/json/{ip}?fields=city,country` (free, no key, 45 req/min).

Called non-blocking with a 1.5 s timeout during login. On timeout or error, `city` and `country` stored as `null` — login is never delayed.

Localhost/private IPs (`127.x`, `::1`, `10.x`, `192.168.x`, `172.16-31.x`) skip the lookup and store `null`.

---

## Modified: `/api/admin/login` route

Extended flow:

1. Extract `ip` via existing `clientIp()` and `user_agent` from `request.headers.get('user-agent')`.
2. Parse UA → `{ browser, os, device }`.
3. Attempt auth (`supabase.auth.signInWithPassword`).
4. Start geolocation fetch (non-blocking, 1.5 s cap) in parallel with staff profile check.
5. Insert `admin_login_events` row with all fields once both resolve.
6. Trim to 50 per staff (skip if staff_id is null).
7. Return existing response (unchanged to caller).

Failure reasons:
- `"invalid_credentials"` — auth rejected email/password
- `"not_staff"` — auth passed but no `staff_profiles` row

---

## New API Route: `GET /api/admin/login-events`

Requires `super_admin` role (checked via `requireAdmin()` + role guard).

Query params:
- `?staffId=<uuid>` — return last 50 events for that staff member
- _(no param)_ — return last 200 events across all staff (ordered by `logged_at DESC`)

Response shape:
```ts
type LoginEvent = {
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

---

## UI Changes

### `/admin/staff` — per-staff expandable login history

Each staff row gets an expand chevron. On expand, fetches `GET /api/admin/login-events?staffId=X` and renders a mini-table inside the row:

| Date/Time | IP | Browser | OS | Device | Location | Status |
|---|---|---|---|---|---|---|
| 27 Jul 14:32 | 103.x.x.x | Chrome 125 | Windows 11 | Desktop | Mumbai, India | ✓ |
| 27 Jul 14:10 | 103.x.x.x | Chrome 125 | Windows 11 | Desktop | — | ✗ Invalid credentials |

Status column: green badge for success, red badge for failure with reason.  
Only super_admin can see the expand toggle (admins cannot view others' login history).

### New page: `/admin/security`

Route: `src/app/admin/security/page.tsx`  
Component: `src/components/SecurityPage.tsx`

Full-width table of all recent login events across all staff. Columns:  
**Staff · Date/Time · IP · Browser · OS · Device · Location · Status**

Sortable by Date/Time (default: newest first). No pagination — capped at 50/staff so max ~200 rows if 4 staff.

Auth gate: redirects non-super_admin to `/admin`.

### `AdminManagementNav`

Add "Security" link pointing to `/admin/security`. Visible only when current user role is `super_admin`. Styled consistent with existing nav links. Icon: `ShieldCheck` from lucide-react.

---

## File Checklist

| File | Action |
|---|---|
| `supabase/migrations/20260727100000_admin_login_events.sql` | New — table + grant |
| `src/lib/ua-parser.ts` | New — UA parsing util |
| `src/lib/geo.ts` | New — IP geolocation util |
| `src/app/api/admin/login/route.ts` | Modify — insert event on login |
| `src/app/api/admin/login-events/route.ts` | New — query API |
| `src/app/admin/security/page.tsx` | New — page shell |
| `src/components/SecurityPage.tsx` | New — full audit UI |
| `src/components/StaffManagement.tsx` | Modify — expandable login history per staff |
| `src/components/AdminManagementNav.tsx` | Modify — add Security link |
| `src/lib/types.ts` | Modify — add `LoginEvent` type |
