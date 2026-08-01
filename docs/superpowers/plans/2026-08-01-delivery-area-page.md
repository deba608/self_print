# Delivery Area Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Delivery Area editor from the PricingPanel modal to a dedicated `/admin/delivery-area` page with a sidebar link, mode-picker cards, and an effective-state status banner.

**Architecture:** New client component `ServiceAreaEditor` owns all service-area state/parsing/saving (GET `/api/admin/pricing` on mount, PUT full pricing + edited `serviceArea`). New route `src/app/admin/delivery-area/page.tsx` renders it. Sidebar gains a nav item. PricingPanel loses its Delivery Area section and omits `serviceArea` from its PUT payload — the server (hardened earlier) preserves the stored config when the key is absent.

**Tech Stack:** Next.js 15 App Router, React 19, TS, lucide-react icons, existing admin CSS conventions.

## Global Constraints

- PUT `/api/admin/pricing` requires ALL numeric pricing fields — the editor must GET current pricing first and send `{ ...fetchedPricing, serviceArea: edited }`.
- PricingPanel's PUT must OMIT the `serviceArea` key entirely (server preserves stored config when absent).
- Mode labels (verbatim): "No restriction", "By pincode", "By pincode + area", "By distance (radius)", "By map boundary (polygon)".
- Status banner warning when active mode is unconfigured (fail-open): text `"This mode is on but not configured yet — delivery is currently open everywhere."` Unconfigured means: pincode/pincode_area with empty list; radius missing radiusKm or shop coords; polygon with < 3 vertices.
- Parse/validation rules and error strings identical to the current PricingPanel implementation (buildServiceArea logic moves, not changes).
- `npm run typecheck` + `npm run test` green before each commit.
- Reuse existing types/functions from `@/lib/service-area`: `ServiceAreaConfig`, `ServiceAreaMode`, `DEFAULT_SERVICE_AREA`, `isValidPincode`.

---

### Task 1: ServiceAreaEditor component + page + sidebar link

**Files:**
- Create: `src/components/admin/ServiceAreaEditor.tsx`
- Create: `src/app/admin/delivery-area/page.tsx`
- Modify: `src/components/admin/AdminSidebar.tsx` (navItems)
- Modify: `src/app/admin/management.css` (or the stylesheet other admin pages use — follow imports) for mode cards + banner styles

**Interfaces:**
- Consumes: `ServiceAreaConfig`, `ServiceAreaMode`, `DEFAULT_SERVICE_AREA`, `isValidPincode` from `@/lib/service-area`; `GET/PUT /api/admin/pricing`.
- Produces: default-exported `ServiceAreaEditor` (no props); route `/admin/delivery-area`.

- [ ] **Step 1: ServiceAreaEditor component**

Client component, no props. Structure:

- On mount: `GET /api/admin/pricing` (`credentials: "include"` if other admin fetches use it — match `useAdmin` hook conventions); store the full pricing object; seed editor state from `pricing.serviceArea`. Loading skeleton while fetching (reuse `ManagementSkeleton` if it fits, else a simple spinner div matching admin styles). On 401/error show the same error treatment other admin pages use.
- Editor state: `saMode`, `saPincodesText` (one per line `713347: Area1, Area2`), `saRadius`, `saShopLat`, `saShopLng`, `saPolygonText` (one `lat, lng` per line) — port the exact state seeding, `buildServiceArea()` parser, and error strings from the current `PricingPanel.tsx` implementation (lines with `buildServiceArea`, `saPincodesText`, etc.). Do not change parsing behavior.
- **Mode picker: 5 radio-style cards** in a responsive grid. Each card: lucide icon (`Globe` off / `Hash` pincode / `MapPin` pincode_area / `CircleDot` radius / `Hexagon` polygon), label (verbatim from Global Constraints), one-line description:
  - off: "Deliver everywhere — no gating."
  - pincode: "Only listed pincodes."
  - pincode_area: "Pincodes, narrowed to named localities."
  - radius: "Within a set distance of the shop."
  - polygon: "Inside a custom map boundary."
  Card = `<button type="button" role="radio" aria-checked>` with `.sa-mode-card` / `.sa-mode-card.active` classes; clicking sets `saMode`.
- Below cards: active mode's fields only (same inputs/textareas/hints as current PricingPanel section).
- **Status banner** above the save button, one of:
  - mode off: neutral info: "Delivery is open everywhere."
  - active mode configured: success tone: "Delivery gating is active." plus a one-line summary (e.g. "3 pincodes serviceable", "Within 5 km of shop", "Polygon with 4 corners").
  - active mode unconfigured (see Global Constraints definition): warning tone with the verbatim warning text.
- Save button: `PUT /api/admin/pricing` with `{ ...fetchedPricing, serviceArea: built }`; strip any non-PricingConfig keys the GET returned if the route rejects extras (it validates required numerics only — spreading is fine). On success flash "Saved" like PricingPanel; on error show message. Keep `fetchedPricing` in sync with the PUT response.

- [ ] **Step 2: Page route**

`src/app/admin/delivery-area/page.tsx` — mirror `src/app/admin/orders/page.tsx`:

```tsx
import { Suspense } from "react";
import ServiceAreaEditor from "@/components/admin/ServiceAreaEditor";

export default function Page() {
  return (
    <Suspense>
      <ServiceAreaEditor />
    </Suspense>
  );
}
```

Check how `orders`/`customers` pages get the sidebar/nav chrome (layout.tsx vs `AdminManagementNav` inside the component) and match it exactly so the page doesn't render bare.

- [ ] **Step 3: Sidebar link**

`AdminSidebar.tsx` navItems, after Orders:

```ts
{ href: "/admin/delivery-area", icon: MapPin, label: "Delivery Area" },
```

Import `MapPin` from lucide-react.

- [ ] **Step 4: Styles**

Add `.sa-mode-card` grid + card + active states, banner tones (info/success/warning) to the stylesheet the admin management pages use. Follow existing admin CSS variables/patterns (check `management.css` and `admin.css` for tokens). Responsive: cards wrap on mobile.

- [ ] **Step 5: Verify + commit**

`npm run typecheck` (PricingPanel untouched → still compiles) + `npm run test`.

```bash
git add -A src/components/admin/ServiceAreaEditor.tsx src/app/admin/delivery-area src/components/admin/AdminSidebar.tsx src/app/admin/management.css
git commit -m "feat: dedicated delivery-area admin page with mode cards and status banner"
```

---

### Task 2: Slim PricingPanel

**Files:**
- Modify: `src/components/admin/PricingPanel.tsx`

**Interfaces:**
- Consumes: server behavior — PUT `/api/admin/pricing` preserves stored `serviceArea` when the key is omitted.
- Produces: PricingPanel with no service-area code; onSave payload has NO `serviceArea` key.

- [ ] **Step 1: Remove the Delivery Area section** (the `<section>` with mode select + conditional fields), the six `sa*` state hooks, `buildServiceArea`, related imports (`ServiceAreaMode`, `DEFAULT_SERVICE_AREA`, `isValidPincode`, `ServiceAreaConfig` — whichever become unused), and their `useEffect` resets.
- [ ] **Step 2: handleSave** sends `onSave(nextPricing)` where `nextPricing` is the numeric draft only — no `serviceArea` key. If the `Pricing`/`NumericPricing` typing forces the key, adjust the onSave prop type to `Omit<Pricing, "serviceArea">` and follow the type through `AdminDashboard.savePricing` (it JSON-stringifies the object as-is — no other change needed).
- [ ] **Step 3: Add a small pointer** where the section used to be (optional, one line): `<span className="pricing-hint">Delivery area rules moved to the Delivery Area page.</span>` with a `<Link href="/admin/delivery-area">` if panel styles allow links; skip if it fights the layout.
- [ ] **Step 4: Verify + commit** — typecheck + tests green; manually confirm via grep that no `serviceArea` reference remains in PricingPanel.

```bash
git add src/components/admin/PricingPanel.tsx
git commit -m "refactor: move delivery-area editing out of pricing panel"
```

---

### Task 3: E2E verification (dev server)

- [ ] Sidebar shows "Delivery Area" item; navigates to `/admin/delivery-area`.
- [ ] Mode cards render, switching shows correct fields; status banner reflects off/configured/unconfigured states.
- [ ] Save a pincode config → PUT succeeds → banner updates; reload page → state persists.
- [ ] Open Pricing panel, change a price, save → GET `/api/admin/pricing` still shows the saved serviceArea (omission preserved it).
- [ ] Customer flow still gated per saved config.
- [ ] Reset config to previous value; typecheck + tests green.
