# Delivery Man Role Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `delivery` staff role with a `/delivery` dashboard where riders self-claim paid+printed delivery orders and mark them delivered, without gaining admin access.

**Architecture:** Supabase-only feature (like staff auth). New `requireStaff`/role-scoped guards in `src/lib/security.ts`; `requireAdmin` hardened to reject the `delivery` role. Three API routes under `src/app/api/delivery/` call the already-migrated security-definer RPCs (`claim_delivery_job`, `complete_delivery_job`) and a narrow `DeliveryOrderView` serializer. `/delivery` server page gates by role and renders a client `DeliveryDashboard` with SSE live updates via the existing `sseClients` broadcast.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (Auth + Postgres RPC), existing SSE mechanism.

## Global Constraints

- Migration `supabase/migrations/20260728000000_add_delivery_role.sql` already exists — do NOT create a new migration; DB work is done.
- Never return the full `Job` type from delivery APIs — only `DeliveryOrderView` (no file paths, no pricing breakdown).
- Existing admin route `src/app/api/admin/jobs/[id]/delivery-status/route.ts` stays untouched.
- Pool eligibility: `deliveryMethod='delivery' AND status='printed' AND paidAt NOT NULL AND deliveryStatus IS NULL`.
- Tests: vitest, colocated `*.test.ts` in `src/lib/` (pure functions only — repo convention; routes/components verified manually + typecheck).
- Run `npm run typecheck` before every commit.

---

### Task 1: Role types + auth guards

**Files:**
- Modify: `src/lib/types.ts:21` (`StaffRole`)
- Modify: `src/lib/security.ts`
- Test: none (Supabase-backed, no pure logic; verified by typecheck + Task 6 manual run)

**Interfaces:**
- Produces: `requireStaff(): Promise<StaffProfile | null>` (any role), `requireAdmin(): Promise<StaffProfile | null>` (now rejects `delivery`), `requireStaffResponse()` analogous to `requireAdminResponse()`.

- [ ] **Step 1: Extend StaffRole**

In `src/lib/types.ts`:
```ts
export type StaffRole = "super_admin" | "admin" | "delivery";
```

- [ ] **Step 2: Rework security.ts**

Replace body of `src/lib/security.ts` with:
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { StaffProfile } from "./types";

// Any authenticated staff row (super_admin, admin, delivery).
export async function requireStaff(): Promise<StaffProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, email, display_name, role, invited_by, created_at")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role,
    invitedBy: profile.invited_by,
    createdAt: profile.created_at,
  };
}

// Admin-tier only: delivery riders must never pass this gate.
export async function requireAdmin(): Promise<StaffProfile | null> {
  const staff = await requireStaff();
  if (!staff || staff.role === "delivery") return null;
  return staff;
}

export async function requireAdminResponse(): Promise<NextResponse | null> {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin login required" }, { status: 401 });
  }
  return null;
}

export async function requireStaffResponse(): Promise<NextResponse | null> {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  return null;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` — expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/security.ts
git commit -m "feat: add delivery staff role type; harden requireAdmin to reject it"
```

---

### Task 2: Staff management accepts delivery role

**Files:**
- Modify: `src/app/api/admin/staff/create/route.ts:6` (`VALID_ROLES`)
- Modify: `src/app/api/admin/staff/route.ts` (invite route — same `VALID_ROLES` pattern; find `VALID_ROLES` or role validation and add `'delivery'`)
- Modify: `src/app/api/admin/staff/[id]/route.ts` (`VALID_ROLES`)
- Modify: `src/components/pages/StaffManagement.tsx`

**Interfaces:**
- Consumes: `StaffRole` from Task 1.
- Produces: staff create/invite/role-change APIs accept `role: "delivery"`; UI role pickers show a "Delivery" option; role badge renders "Delivery".

- [ ] **Step 1: API routes**

In each of the three routes, extend validation:
```ts
const VALID_ROLES = ["super_admin", "admin", "delivery"];
```
and update the create route's error copy: `"Role must be 'super_admin', 'admin' or 'delivery'"`.
In `[id]/route.ts` the sole-super-admin demotion guard (`if (role === "admin")`) must also fire when demoting to `delivery`: change condition to `if (role !== "super_admin")`.

- [ ] **Step 2: StaffManagement UI**

In `src/components/pages/StaffManagement.tsx`:
- Widen state types: `useState<"admin" | "super_admin" | "delivery">("admin")` for both `role` and `createRole` state.
- Widen the `role:` field in the local staff-member type (line ~30) to include `"delivery"`.
- Add `<option value="delivery">Delivery</option>` to both `#staff-role` and `#create-role` selects.
- Role badge label: replace the two ternaries `member.role === "super_admin" ? "Owner" : "Admin"` with a helper:
```ts
const roleLabel = (r: string) => (r === "super_admin" ? "Owner" : r === "delivery" ? "Delivery" : "Admin");
```
- The promote/demote toggle button only applies to super_admin/admin; render the plain (non-toggle) badge for `delivery` members (keep toggle branch conditional on `member.role !== "delivery"`).
- Role help text: add a branch for delivery, e.g. "Delivery riders can only see and complete delivery orders."

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npm run typecheck` — clean. (UI verified in Task 6 e2e pass.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/staff src/components/pages/StaffManagement.tsx
git commit -m "feat: allow creating delivery-role staff accounts"
```

---

### Task 3: DeliveryOrderView serializer + GET /api/delivery/jobs

**Files:**
- Create: `src/lib/delivery.ts`
- Create: `src/lib/delivery.test.ts`
- Create: `src/app/api/delivery/jobs/route.ts`

**Interfaces:**
- Consumes: `requireStaff` (Task 1), Supabase server client `createClient` from `@/lib/supabase/server`.
- Produces:
```ts
export type DeliveryOrderView = {
  id: string;
  token: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  pageCount: number;
  copies: number;
  amountPaise: number;        // price_paise + delivery_fee_paise
  createdAt: string;
  deliveryStatus: "out_for_delivery" | null;
};
export function toDeliveryOrderView(row: DeliveryJobRow): DeliveryOrderView;
export const DELIVERY_JOB_COLUMNS: string; // supabase select string
```
- `GET /api/delivery/jobs` → `{ available: DeliveryOrderView[], mine: DeliveryOrderView[] }`.

- [ ] **Step 1: Write failing test**

`src/lib/delivery.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { toDeliveryOrderView, type DeliveryJobRow } from "./delivery";

const row: DeliveryJobRow = {
  id: "j1",
  token: "TOK123",
  customer_name: "Asha",
  customer_phone: "9999999999",
  delivery_address: "12 Main St",
  delivery_latitude: 12.9,
  delivery_longitude: 77.6,
  page_count: 4,
  copies: 2,
  price_paise: 4000,
  delivery_fee_paise: 2000,
  created_at: "2026-08-01T10:00:00Z",
  delivery_status: null,
};

describe("toDeliveryOrderView", () => {
  it("maps snake_case row to narrow camelCase view with summed amount", () => {
    expect(toDeliveryOrderView(row)).toEqual({
      id: "j1",
      token: "TOK123",
      customerName: "Asha",
      customerPhone: "9999999999",
      deliveryAddress: "12 Main St",
      deliveryLatitude: 12.9,
      deliveryLongitude: 77.6,
      pageCount: 4,
      copies: 2,
      amountPaise: 6000,
      createdAt: "2026-08-01T10:00:00Z",
      deliveryStatus: null,
    });
  });

  it("never exposes extra columns", () => {
    const view = toDeliveryOrderView({ ...row, storage_path: "secret.pdf" } as never);
    expect(Object.keys(view)).not.toContain("storage_path");
    expect(Object.keys(view)).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/delivery.test.ts` — expected FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/delivery.ts`**

```ts
// Narrow serializer for delivery riders. Never widen this to the full Job
// type: riders must not see file paths, pricing breakdown, or admin fields.
export type DeliveryJobRow = {
  id: string;
  token: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  page_count: number;
  copies: number;
  price_paise: number;
  delivery_fee_paise: number;
  created_at: string;
  delivery_status: "out_for_delivery" | null;
};

export const DELIVERY_JOB_COLUMNS =
  "id, token, customer_name, customer_phone, delivery_address, delivery_latitude, delivery_longitude, page_count, copies, price_paise, delivery_fee_paise, created_at, delivery_status";

export type DeliveryOrderView = {
  id: string;
  token: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  pageCount: number;
  copies: number;
  amountPaise: number;
  createdAt: string;
  deliveryStatus: "out_for_delivery" | null;
};

export function toDeliveryOrderView(row: DeliveryJobRow): DeliveryOrderView {
  return {
    id: row.id,
    token: row.token,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    deliveryAddress: row.delivery_address,
    deliveryLatitude: row.delivery_latitude,
    deliveryLongitude: row.delivery_longitude,
    pageCount: row.page_count,
    copies: row.copies,
    amountPaise: row.price_paise + row.delivery_fee_paise,
    createdAt: row.created_at,
    deliveryStatus: row.delivery_status,
  };
}
```

- [ ] **Step 4: Run tests — pass**

Run: `npx vitest run src/lib/delivery.test.ts` — expected PASS.

- [ ] **Step 5: Implement `src/app/api/delivery/jobs/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { DELIVERY_JOB_COLUMNS, toDeliveryOrderView, type DeliveryJobRow } from "@/lib/delivery";

export async function GET() {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: availableRows, error: availableError } = await supabase
    .from("jobs")
    .select(DELIVERY_JOB_COLUMNS)
    .eq("delivery_method", "delivery")
    .eq("status", "printed")
    .not("paid_at", "is", null)
    .is("delivery_status", null)
    .order("created_at", { ascending: true });

  const { data: mineRows, error: mineError } = await supabase
    .from("jobs")
    .select(DELIVERY_JOB_COLUMNS)
    .eq("delivery_method", "delivery")
    .eq("delivery_status", "out_for_delivery")
    .eq("delivery_person_id", staff.id)
    .order("created_at", { ascending: true });

  if (availableError || mineError) {
    return NextResponse.json({ error: "Failed to load delivery jobs" }, { status: 500 });
  }

  return NextResponse.json({
    available: ((availableRows ?? []) as DeliveryJobRow[]).map(toDeliveryOrderView),
    mine: ((mineRows ?? []) as DeliveryJobRow[]).map(toDeliveryOrderView),
  });
}
```

- [ ] **Step 6: Typecheck + full tests**

Run: `npm run typecheck && npm run test` — expected: clean/PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/delivery.ts src/lib/delivery.test.ts src/app/api/delivery/jobs/route.ts
git commit -m "feat: delivery jobs pool API with narrow DeliveryOrderView serializer"
```

---

### Task 4: Claim + delivered routes (RPC-backed) with SSE broadcast

**Files:**
- Create: `src/app/api/delivery/jobs/[id]/claim/route.ts`
- Create: `src/app/api/delivery/jobs/[id]/delivered/route.ts`

**Interfaces:**
- Consumes: `requireStaff` (Task 1); Supabase RPCs `claim_delivery_job(p_job_id uuid) → int` (0 ok, 1 already claimed, 2 not eligible) and `complete_delivery_job(p_job_id uuid) → int` (0 ok, 1 not owned, 2 not eligible) from migration `20260728000000_add_delivery_role.sql`; `sseClients` from `@/lib/db`.
- Produces: `POST /api/delivery/jobs/[id]/claim` → 200 `{ ok: true }` | 409 | 400; `POST .../delivered` → 200 | 403 | 400.

- [ ] **Step 1: claim route**

`src/app/api/delivery/jobs/[id]/claim/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { sseClients } from "@/lib/db";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_delivery_job", { p_job_id: id });
  if (error) {
    return NextResponse.json({ error: "Failed to claim delivery" }, { status: 500 });
  }
  if (data === 1) {
    return NextResponse.json({ error: "Another rider already claimed this order." }, { status: 409 });
  }
  if (data === 2) {
    return NextResponse.json({ error: "This order is not ready for delivery." }, { status: 400 });
  }

  broadcast({ type: "job_update", jobId: id, deliveryStatus: "out_for_delivery" });
  return NextResponse.json({ ok: true });
}

function broadcast(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(client);
    }
  }
}
```

- [ ] **Step 2: delivered route**

`src/app/api/delivery/jobs/[id]/delivered/route.ts` — identical shape, RPC `complete_delivery_job`, code 1 → 403 `"You did not claim this order."`, code 2 → 400 `"This order is not out for delivery."`, broadcast `deliveryStatus: "delivered"`.
```ts
import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { sseClients } from "@/lib/db";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_delivery_job", { p_job_id: id });
  if (error) {
    return NextResponse.json({ error: "Failed to complete delivery" }, { status: 500 });
  }
  if (data === 1) {
    return NextResponse.json({ error: "You did not claim this order." }, { status: 403 });
  }
  if (data === 2) {
    return NextResponse.json({ error: "This order is not out for delivery." }, { status: 400 });
  }

  broadcast({ type: "job_update", jobId: id, deliveryStatus: "delivered" });
  return NextResponse.json({ ok: true });
}

function broadcast(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.controller.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(client);
    }
  }
}
```

Note: RPCs run as the *authenticated user* via `auth.uid()`; the server client carries the user's session, so this works for riders. Admin override path inside `complete_delivery_job` covers admin/super_admin callers.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` — clean.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/delivery/jobs/[id]"
git commit -m "feat: delivery claim/delivered API routes via security-definer RPCs"
```

---

### Task 5: /delivery page + dashboard UI

**Files:**
- Create: `src/app/delivery/page.tsx`
- Create: `src/components/pages/DeliveryDashboard.tsx`
- Create: `src/components/delivery/DeliveryOrderCard.tsx`
- Create: `src/app/styles/delivery.css` (import from dashboard component or `src/app/delivery/page.tsx`; follow how `admin-delivery.css` is imported — check `src/app` global css imports and mirror)
- Modify: `src/app/admin/page.tsx` (redirect delivery role)

**Interfaces:**
- Consumes: `DeliveryOrderView` (Task 3), `GET /api/delivery/jobs`, `POST /api/delivery/jobs/[id]/claim|delivered` (Task 4), existing SSE endpoint used by admin dashboard (find `EventSource(` in `src/components/pages/AdminDashboard.tsx` and reuse the same URL, likely `/api/admin/notifications` or similar — reuse exact path).
- Produces: `/delivery` route; delivery-role users landing on `/admin` get `redirect("/delivery")`.

- [ ] **Step 1: Server page `src/app/delivery/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/security";
import DeliveryDashboard from "@/components/pages/DeliveryDashboard";

export default async function DeliveryPage() {
  const staff = await requireStaff();
  if (!staff) redirect("/admin"); // /admin renders the staff login form
  return <DeliveryDashboard staffName={staff.displayName ?? staff.email} />;
}
```

- [ ] **Step 2: Redirect delivery role away from /admin**

In `src/app/admin/page.tsx`, select `role` too and redirect:
```tsx
import { redirect } from "next/navigation";
// ...
      const { data: profile } = await supabase
        .from("staff_profiles")
        .select("id, role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role === "delivery") redirect("/delivery");
      if (profile) return <AdminDashboard />;
```
IMPORTANT: `redirect()` throws `NEXT_REDIRECT`; the existing `try/catch` around this block would swallow it. Either move the redirect outside the try, or rethrow:
```ts
  } catch (err) {
    if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
    // Supabase env not configured — fall through to the login form.
  }
```
(Next 15 exposes `isRedirectError` from `next/dist/client/components/redirect` internals — do NOT import internals; the digest check above via `(err as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")` is the robust form. Use:)
```ts
  } catch (err) {
    if (typeof (err as { digest?: string })?.digest === "string" &&
        (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")) {
      throw err;
    }
    // Supabase env not configured — fall through to the login form.
  }
```

- [ ] **Step 3: `DeliveryOrderCard` component**

`src/components/delivery/DeliveryOrderCard.tsx`:
```tsx
"use client";

import type { DeliveryOrderView } from "@/lib/delivery";

type Props = {
  order: DeliveryOrderView;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
};

export default function DeliveryOrderCard({ order, actionLabel, onAction, busy }: Props) {
  const mapUrl =
    order.deliveryLatitude != null && order.deliveryLongitude != null
      ? `https://www.google.com/maps?q=${order.deliveryLatitude},${order.deliveryLongitude}`
      : null;

  return (
    <article className="delivery-card">
      <header className="delivery-card-head">
        <span className="delivery-card-token">{order.token}</span>
        <span className="delivery-card-amount">₹{(order.amountPaise / 100).toFixed(2)}</span>
      </header>
      <div className="delivery-card-body">
        <p className="delivery-card-name">{order.customerName ?? "Customer"}</p>
        {order.customerPhone && (
          <a className="delivery-card-phone" href={`tel:${order.customerPhone}`}>
            {order.customerPhone}
          </a>
        )}
        {order.deliveryAddress && <p className="delivery-card-address">{order.deliveryAddress}</p>}
        <p className="delivery-card-meta">
          {order.pageCount} page{order.pageCount === 1 ? "" : "s"} × {order.copies}{" "}
          {order.copies === 1 ? "copy" : "copies"}
        </p>
        {mapUrl && (
          <a className="delivery-card-map" href={mapUrl} target="_blank" rel="noreferrer">
            Open in Maps
          </a>
        )}
      </div>
      <button className="delivery-card-action" onClick={onAction} disabled={busy}>
        {busy ? "Working…" : actionLabel}
      </button>
    </article>
  );
}
```

- [ ] **Step 4: `DeliveryDashboard` component**

`src/components/pages/DeliveryDashboard.tsx`:
```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeliveryOrderView } from "@/lib/delivery";
import DeliveryOrderCard from "@/components/delivery/DeliveryOrderCard";
import "@/app/styles/delivery.css";

type Props = { staffName: string };

export default function DeliveryDashboard({ staffName }: Props) {
  const [available, setAvailable] = useState<DeliveryOrderView[]>([]);
  const [mine, setMine] = useState<DeliveryOrderView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/delivery/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load orders");
      const body = await res.json();
      setAvailable(body.available ?? []);
      setMine(body.mine ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Reuse the admin SSE stream so claims by other riders refresh this list
    // live. Fall back to 15s polling if SSE drops.
    const es = new EventSource("/api/admin/notifications"); // ← adjust to the exact SSE path AdminDashboard uses
    es.onmessage = () => load();
    const poll = setInterval(load, 15000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [load]);

  async function act(id: string, path: "claim" | "delivered") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/delivery/jobs/${id}/${path}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Action failed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
      load();
    }
  }

  return (
    <main className="delivery-page">
      <header className="delivery-header">
        <h1>Deliveries</h1>
        <div className="delivery-header-right">
          <span className="delivery-staff-name">{staffName}</span>
          <form action="/api/admin/logout" method="post">
            <button type="submit" className="delivery-logout">Log out</button>
          </form>
        </div>
      </header>

      {error && <p className="delivery-error" role="alert">{error}</p>}
      {loading && <p className="delivery-loading">Loading orders…</p>}

      <section className="delivery-section">
        <h2>My deliveries ({mine.length})</h2>
        {mine.length === 0 && !loading && <p className="delivery-empty">No active deliveries.</p>}
        <div className="delivery-grid">
          {mine.map((order) => (
            <DeliveryOrderCard
              key={order.id}
              order={order}
              actionLabel="Mark delivered"
              busy={busyId === order.id}
              onAction={() => act(order.id, "delivered")}
            />
          ))}
        </div>
      </section>

      <section className="delivery-section">
        <h2>Available ({available.length})</h2>
        {available.length === 0 && !loading && <p className="delivery-empty">No orders waiting.</p>}
        <div className="delivery-grid">
          {available.map((order) => (
            <DeliveryOrderCard
              key={order.id}
              order={order}
              actionLabel="Claim"
              busy={busyId === order.id}
              onAction={() => act(order.id, "claim")}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
```
Before wiring SSE: grep `EventSource(` in `src/components/pages/AdminDashboard.tsx` and use that exact URL. Also grep for the logout route (`logout`) and use the real path/method; if logout is done via a client supabase call in `AdminTopbar.tsx`, copy that pattern instead of the form.

- [ ] **Step 5: `delivery.css`**

Mobile-first, mirror class names used above. Check how `src/app/styles/admin-delivery.css` gets imported (likely in a component or `layout.tsx`) and import `delivery.css` the same way if component-level import fails. Keep it simple:
```css
.delivery-page { padding: 16px; max-width: 640px; margin: 0 auto; }
.delivery-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.delivery-header-right { display: flex; gap: 10px; align-items: center; }
.delivery-section { margin-bottom: 24px; }
.delivery-grid { display: grid; gap: 12px; }
.delivery-card { border: 1px solid var(--border, #e2e8f0); border-radius: 12px; padding: 14px; display: grid; gap: 8px; }
.delivery-card-head { display: flex; justify-content: space-between; font-weight: 600; }
.delivery-card-action { padding: 10px; border-radius: 8px; border: none; background: #2563eb; color: #fff; font-weight: 600; }
.delivery-card-action:disabled { opacity: 0.6; }
.delivery-error { color: #dc2626; }
.delivery-empty, .delivery-loading { color: #64748b; }
.delivery-card-map, .delivery-card-phone { color: #2563eb; text-decoration: underline; }
```
Match existing project styling conventions (inspect `admin-delivery.css` for tokens/vars actually used and reuse them).

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck && npm run build` — expected: clean. (Kill stray Selfprint node processes first if `.next` is locked — known gotcha.)

- [ ] **Step 7: Commit**

```bash
git add src/app/delivery src/components/pages/DeliveryDashboard.tsx src/components/delivery src/app/styles/delivery.css src/app/admin/page.tsx
git commit -m "feat: delivery rider dashboard with self-claim pool"
```

---

### Task 6: End-to-end verification + apply migration

**Files:** none (verification task)

- [ ] **Step 1: Full test + typecheck + build**

Run: `npm run test && npm run typecheck && npm run build` — all clean.

- [ ] **Step 2: Apply migration to Supabase**

Check whether `20260728000000_add_delivery_role.sql` is applied (`mcp__supabase__list_migrations` or dashboard). If not, apply via `mcp__supabase__apply_migration` with the file's content. Verify `claim_delivery_job` exists: `select proname from pg_proc where proname like '%delivery%';`

- [ ] **Step 3: Manual e2e (needs Supabase env + a delivery test account)**

1. `npm run dev`; log in as super_admin at `/admin` → Staff → create user with role Delivery.
2. Log in as the delivery user → confirm redirect `/admin` → `/delivery`, and that `/api/admin/jobs` etc. return 401 for that session.
3. Seed a delivery job (upload with delivery method, mark paid + printed via admin) → appears in Available.
4. Claim → moves to My deliveries; second browser as another rider sees it vanish (SSE).
5. Mark delivered → disappears; admin dashboard shows delivered.

- [ ] **Step 4: Commit any fixes, then final commit**

```bash
git add -A
git commit -m "chore: delivery role e2e fixes"
```

---

## Self-Review Notes

- Spec coverage: role constraint/column/RPCs (migration, pre-existing) ✓; guards Task 1 ✓; invite UI Task 2 ✓; APIs Tasks 3–4 ✓; `/delivery` UI + redirect Task 5 ✓; SSE Task 5 ✓; admin override route untouched ✓.
- Known unknowns flagged inline (SSE endpoint URL, logout mechanism, css import convention) — implementer must resolve by grepping the named files, not guessing.
- `requireAdmin` change is the security-critical piece: every existing admin route imports it, so delivery lock-out is centralized — no per-route edits needed.
