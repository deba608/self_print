# Service-Area-Gated Delivery (Hybrid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate home delivery by an admin-selectable strategy — off / pincode / pincode+area / GPS radius / GPS polygon — switchable from the dashboard.

**Architecture:** Pure module `src/lib/service-area.ts` holds config types, a defensive JSON parser, and one evaluator `checkDeliveryServiceable` (strategy per mode). Config persists as JSON in a new `service_area_config` TEXT column on `pricing_config`; jobs gain `delivery_pincode` + `delivery_area`. Server enforcement in `POST /api/jobs` (single + bulk); UX in UploadForm; mode-aware editor in PricingPanel. Dual DB (SQLite auto-migrate + Supabase SQL migration).

**Tech Stack:** Next.js 15 App Router, TypeScript, better-sqlite3 + Supabase dual DB, vitest.

## Global Constraints

- Pincode format: `/^[1-9]\d{5}$/` (6 digits, no leading zero).
- Default / malformed / empty `service_area_config` → mode `"off"` = delivery everywhere (backward compatible).
- Unusable active-mode config (radius without shop coords, polygon with < 3 vertices, pincode mode with empty list) **fails open** — misconfiguration must never silently kill delivery.
- All mode sections persist in the JSON regardless of active mode (switching modes loses nothing).
- Rejection copy (verbatim, from evaluator reasons):
  - pincode modes: `"Delivery is not available for this pincode yet — please choose pickup"`
  - area: `"Delivery is not available in this area yet — please choose pickup"`
  - GPS modes: `"Your location is outside our delivery area — please choose pickup"`
  - missing GPS in GPS modes: `"Location is required for home delivery — please share your location"`
- Delivery orders always collect a valid pincode (every mode, incl. off/GPS — kept for records/rider).
- Server is the enforcement point; client checks are UX only.
- `npm run typecheck` and `npm run test` green before each commit.

---

### Task 1: service-area core module

**Files:**
- Create: `src/lib/service-area.ts`
- Test: `src/lib/service-area.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (exact signatures later tasks rely on):

```ts
export type ServiceAreaMode = "off" | "pincode" | "pincode_area" | "radius" | "polygon";
export type ServicePincode = { pincode: string; areas: string[] };
export type ServiceAreaConfig = {
  mode: ServiceAreaMode;
  pincodes: ServicePincode[];
  radiusKm: number | null;
  shopLat: number | null;
  shopLng: number | null;
  polygon: Array<[number, number]>; // [lat, lng]
};
export type ServiceCheckInput = {
  pincode: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
};
export type ServiceCheckResult = { ok: true } | { ok: false; reason: string };

export const DEFAULT_SERVICE_AREA: ServiceAreaConfig; // mode "off", empty everything
export function isValidPincode(value: string): boolean;
export function parseServiceAreaConfig(raw: string | null | undefined): ServiceAreaConfig;
export function serializeServiceAreaConfig(config: ServiceAreaConfig): string; // JSON.stringify of a sanitized config
export function validateServiceAreaConfig(value: unknown): { config: ServiceAreaConfig } | { error: string };
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number;
export function pointInPolygon(lat: number, lng: number, polygon: Array<[number, number]>): boolean;
export function checkDeliveryServiceable(input: ServiceCheckInput, config: ServiceAreaConfig): ServiceCheckResult;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/service-area.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_AREA, checkDeliveryServiceable, haversineKm, isValidPincode,
  parseServiceAreaConfig, pointInPolygon, serializeServiceAreaConfig, validateServiceAreaConfig,
} from "./service-area";
import type { ServiceAreaConfig } from "./service-area";

const base = (over: Partial<ServiceAreaConfig>): ServiceAreaConfig => ({ ...DEFAULT_SERVICE_AREA, ...over });
const input = (over: Partial<Parameters<typeof checkDeliveryServiceable>[0]>) => ({
  pincode: null, area: null, lat: null, lng: null, ...over,
});

describe("isValidPincode", () => {
  it("accepts 6 digits not starting with 0", () => expect(isValidPincode("713347")).toBe(true));
  it.each(["013347", "71334", "7133471", "71334a", ""])("rejects %j", (v) =>
    expect(isValidPincode(v)).toBe(false));
});

describe("parseServiceAreaConfig", () => {
  it("returns mode off for null/empty/malformed", () => {
    expect(parseServiceAreaConfig(null).mode).toBe("off");
    expect(parseServiceAreaConfig("").mode).toBe("off");
    expect(parseServiceAreaConfig("{not json").mode).toBe("off");
  });
  it("round-trips through serialize", () => {
    const cfg = base({ mode: "pincode", pincodes: [{ pincode: "713347", areas: ["Sitarampur"] }] });
    expect(parseServiceAreaConfig(serializeServiceAreaConfig(cfg))).toEqual(cfg);
  });
  it("drops invalid pincodes and unknown modes", () => {
    const parsed = parseServiceAreaConfig(JSON.stringify({
      mode: "banana", pincodes: [{ pincode: "0999", areas: [] }, { pincode: "713347", areas: [] }],
    }));
    expect(parsed.mode).toBe("off");
    expect(parsed.pincodes).toEqual([{ pincode: "713347", areas: [] }]);
  });
});

describe("validateServiceAreaConfig", () => {
  it("rejects a non-object", () => {
    expect(validateServiceAreaConfig("x")).toHaveProperty("error");
  });
  it("rejects bad radius", () => {
    expect(validateServiceAreaConfig({ ...DEFAULT_SERVICE_AREA, radiusKm: -1 })).toHaveProperty("error");
  });
  it("accepts a full valid config", () => {
    const cfg = base({ mode: "radius", radiusKm: 5, shopLat: 23.68, shopLng: 86.98 });
    expect(validateServiceAreaConfig(cfg)).toEqual({ config: cfg });
  });
});

describe("haversineKm", () => {
  it("is ~0 for identical points", () => expect(haversineKm(23.68, 86.98, 23.68, 86.98)).toBeCloseTo(0, 5));
  it("computes a known distance (~1 deg lat ≈ 111 km)", () =>
    expect(haversineKm(23, 86.98, 24, 86.98)).toBeGreaterThan(110));
});

describe("pointInPolygon", () => {
  const tri: Array<[number, number]> = [[0, 0], [0, 10], [10, 0]];
  it("inside", () => expect(pointInPolygon(2, 2, tri)).toBe(true));
  it("outside", () => expect(pointInPolygon(8, 8, tri)).toBe(false));
});

describe("checkDeliveryServiceable", () => {
  it("mode off allows anything", () =>
    expect(checkDeliveryServiceable(input({}), DEFAULT_SERVICE_AREA)).toEqual({ ok: true }));

  it("pincode mode: listed ok, unlisted rejected, empty list fails open", () => {
    const cfg = base({ mode: "pincode", pincodes: [{ pincode: "713347", areas: [] }] });
    expect(checkDeliveryServiceable(input({ pincode: "713347" }), cfg)).toEqual({ ok: true });
    expect(checkDeliveryServiceable(input({ pincode: "560001" }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({ pincode: "560001" }), base({ mode: "pincode" }))).toEqual({ ok: true });
  });

  it("pincode_area mode: area required only when pincode defines areas; case-insensitive match", () => {
    const cfg = base({ mode: "pincode_area", pincodes: [
      { pincode: "713347", areas: ["Sitarampur"] },
      { pincode: "713343", areas: [] },
    ]});
    expect(checkDeliveryServiceable(input({ pincode: "713347", area: "sitarampur" }), cfg)).toEqual({ ok: true });
    expect(checkDeliveryServiceable(input({ pincode: "713347", area: "Elsewhere" }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({ pincode: "713347", area: null }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({ pincode: "713343", area: null }), cfg)).toEqual({ ok: true });
  });

  it("radius mode: inside ok, outside rejected, missing GPS rejected, no shop coords fails open", () => {
    const cfg = base({ mode: "radius", radiusKm: 5, shopLat: 23.68, shopLng: 86.98 });
    expect(checkDeliveryServiceable(input({ lat: 23.681, lng: 86.981 }), cfg)).toEqual({ ok: true });
    expect(checkDeliveryServiceable(input({ lat: 24.5, lng: 86.98 }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({}), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({}), base({ mode: "radius" }))).toEqual({ ok: true });
  });

  it("polygon mode: inside ok, outside rejected, missing GPS rejected, <3 vertices fails open", () => {
    const cfg = base({ mode: "polygon", polygon: [[23.6, 86.9], [23.6, 87.1], [23.8, 87.0]] });
    expect(checkDeliveryServiceable(input({ lat: 23.65, lng: 86.99 }), cfg)).toEqual({ ok: true });
    expect(checkDeliveryServiceable(input({ lat: 25, lng: 90 }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({}), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({}), base({ mode: "polygon", polygon: [[0, 0]] }))).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/service-area.test.ts`
Expected: FAIL — cannot resolve `./service-area`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/service-area.ts
// Admin-selectable delivery gating. One active mode; every mode's data persists
// so switching modes never loses configuration. Unusable active-mode config
// fails OPEN — a half-filled dashboard form must not silently kill delivery.

export type ServiceAreaMode = "off" | "pincode" | "pincode_area" | "radius" | "polygon";
export type ServicePincode = { pincode: string; areas: string[] };
export type ServiceAreaConfig = {
  mode: ServiceAreaMode;
  pincodes: ServicePincode[];
  radiusKm: number | null;
  shopLat: number | null;
  shopLng: number | null;
  polygon: Array<[number, number]>;
};
export type ServiceCheckInput = {
  pincode: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
};
export type ServiceCheckResult = { ok: true } | { ok: false; reason: string };

const MODES: ServiceAreaMode[] = ["off", "pincode", "pincode_area", "radius", "polygon"];
const PINCODE_RE = /^[1-9]\d{5}$/;
const MAX_AREA_LEN = 60;

export const REASON_PINCODE = "Delivery is not available for this pincode yet — please choose pickup";
export const REASON_AREA = "Delivery is not available in this area yet — please choose pickup";
export const REASON_LOCATION = "Your location is outside our delivery area — please choose pickup";
export const REASON_LOCATION_REQUIRED = "Location is required for home delivery — please share your location";

export const DEFAULT_SERVICE_AREA: ServiceAreaConfig = {
  mode: "off", pincodes: [], radiusKm: null, shopLat: null, shopLng: null, polygon: [],
};

export function isValidPincode(value: string): boolean {
  return PINCODE_RE.test(value);
}

function sanitize(value: unknown): ServiceAreaConfig {
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const mode = MODES.includes(obj.mode as ServiceAreaMode) ? (obj.mode as ServiceAreaMode) : "off";
  const pincodes: ServicePincode[] = [];
  if (Array.isArray(obj.pincodes)) {
    const seen = new Set<string>();
    for (const entry of obj.pincodes) {
      const pin = String((entry as any)?.pincode ?? "").trim();
      if (!isValidPincode(pin) || seen.has(pin)) continue;
      seen.add(pin);
      const areasRaw = Array.isArray((entry as any)?.areas) ? (entry as any).areas : [];
      const areas = [...new Set(
        areasRaw.map((a: unknown) => String(a).trim()).filter((a: string) => a.length > 0 && a.length <= MAX_AREA_LEN)
      )] as string[];
      pincodes.push({ pincode: pin, areas });
    }
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const radiusKm = num(obj.radiusKm);
  const shopLat = num(obj.shopLat);
  const shopLng = num(obj.shopLng);
  const polygon: Array<[number, number]> = [];
  if (Array.isArray(obj.polygon)) {
    for (const v of obj.polygon) {
      if (Array.isArray(v) && v.length === 2) {
        const lat = num(v[0]); const lng = num(v[1]);
        if (lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          polygon.push([lat, lng]);
        }
      }
    }
  }
  return {
    mode, pincodes,
    radiusKm: radiusKm !== null && radiusKm > 0 ? radiusKm : null,
    shopLat: shopLat !== null && shopLat >= -90 && shopLat <= 90 ? shopLat : null,
    shopLng: shopLng !== null && shopLng >= -180 && shopLng <= 180 ? shopLng : null,
    polygon,
  };
}

export function parseServiceAreaConfig(raw: string | null | undefined): ServiceAreaConfig {
  if (!raw) return { ...DEFAULT_SERVICE_AREA };
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SERVICE_AREA };
  }
}

export function serializeServiceAreaConfig(config: ServiceAreaConfig): string {
  return JSON.stringify(sanitize(config));
}

// Strict admin-input validation: unlike sanitize (which silently repairs stored
// data), this REJECTS so the dashboard surfaces mistakes instead of eating them.
export function validateServiceAreaConfig(value: unknown): { config: ServiceAreaConfig } | { error: string } {
  if (!value || typeof value !== "object") return { error: "Invalid service area config" };
  const obj = value as Record<string, unknown>;
  if (!MODES.includes(obj.mode as ServiceAreaMode)) return { error: "Invalid service area mode" };
  if (obj.pincodes !== undefined) {
    if (!Array.isArray(obj.pincodes)) return { error: "pincodes must be a list" };
    for (const entry of obj.pincodes) {
      const pin = String((entry as any)?.pincode ?? "");
      if (!isValidPincode(pin)) return { error: `Invalid pincode: ${pin}` };
      const areas = (entry as any)?.areas;
      if (areas !== undefined && !Array.isArray(areas)) return { error: `Areas for ${pin} must be a list` };
      for (const a of areas ?? []) {
        const name = String(a).trim();
        if (!name || name.length > MAX_AREA_LEN) return { error: `Invalid area name for ${pin}` };
      }
    }
  }
  if (obj.radiusKm !== undefined && obj.radiusKm !== null) {
    if (typeof obj.radiusKm !== "number" || !(obj.radiusKm > 0) || obj.radiusKm > 500) {
      return { error: "Radius must be between 0 and 500 km" };
    }
  }
  const coord = (v: unknown, min: number, max: number) =>
    v === undefined || v === null || (typeof v === "number" && v >= min && v <= max);
  if (!coord(obj.shopLat, -90, 90) || !coord(obj.shopLng, -180, 180)) {
    return { error: "Invalid shop coordinates" };
  }
  if (obj.polygon !== undefined) {
    if (!Array.isArray(obj.polygon)) return { error: "Polygon must be a list of [lat, lng] pairs" };
    for (const v of obj.polygon) {
      if (!Array.isArray(v) || v.length !== 2 || !coord(v[0], -90, 90) || !coord(v[1], -180, 180) ||
          v[0] === null || v[1] === null) {
        return { error: "Polygon must be a list of [lat, lng] pairs" };
      }
    }
  }
  return { config: sanitize(value) };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Ray casting: count edge crossings of a horizontal ray; odd = inside.
export function pointInPolygon(lat: number, lng: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    if ((lngI > lng) !== (lngJ > lng) &&
        lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI) {
      inside = !inside;
    }
  }
  return inside;
}

export function checkDeliveryServiceable(input: ServiceCheckInput, config: ServiceAreaConfig): ServiceCheckResult {
  switch (config.mode) {
    case "off":
      return { ok: true };
    case "pincode": {
      if (config.pincodes.length === 0) return { ok: true }; // fail open: mode on, list not filled yet
      if (!input.pincode || !config.pincodes.some((p) => p.pincode === input.pincode)) {
        return { ok: false, reason: REASON_PINCODE };
      }
      return { ok: true };
    }
    case "pincode_area": {
      if (config.pincodes.length === 0) return { ok: true };
      const entry = input.pincode ? config.pincodes.find((p) => p.pincode === input.pincode) : undefined;
      if (!entry) return { ok: false, reason: REASON_PINCODE };
      if (entry.areas.length === 0) return { ok: true }; // whole pincode serviceable
      const area = (input.area ?? "").trim().toLowerCase();
      if (!area || !entry.areas.some((a) => a.toLowerCase() === area)) {
        return { ok: false, reason: REASON_AREA };
      }
      return { ok: true };
    }
    case "radius": {
      if (config.radiusKm === null || config.shopLat === null || config.shopLng === null) return { ok: true };
      if (input.lat === null || input.lng === null) return { ok: false, reason: REASON_LOCATION_REQUIRED };
      return haversineKm(config.shopLat, config.shopLng, input.lat, input.lng) <= config.radiusKm
        ? { ok: true }
        : { ok: false, reason: REASON_LOCATION };
    }
    case "polygon": {
      if (config.polygon.length < 3) return { ok: true };
      if (input.lat === null || input.lng === null) return { ok: false, reason: REASON_LOCATION_REQUIRED };
      return pointInPolygon(input.lat, input.lng, config.polygon)
        ? { ok: true }
        : { ok: false, reason: REASON_LOCATION };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/service-area.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/service-area.ts src/lib/service-area.test.ts
git commit -m "feat: add hybrid service-area engine (pincode/area/radius/polygon)"
```

---

### Task 2: Types + SQLite layer

**Files:**
- Modify: `src/lib/types.ts` (PricingConfig ~line 119-134, Job ~line 68-86)
- Modify: `src/lib/db.ts` (ensureJobColumns ~181, ensurePricingColumns ~225, mapJob ~299-313, jobData normalization ~619, job INSERT ~631, getPricing ~836, updatePricing ~855)

**Interfaces:**
- Consumes: `ServiceAreaConfig`, `parseServiceAreaConfig`, `serializeServiceAreaConfig` (Task 1).
- Produces: `PricingConfig.serviceArea: ServiceAreaConfig`; `Job.deliveryPincode: string | null`; `Job.deliveryArea: string | null`; `createJob`/`createJobWithFiles` accept `delivery_pincode`/`delivery_area` in jobData.

- [ ] **Step 1: Extend types**

`src/lib/types.ts`:
- Top: `import type { ServiceAreaConfig } from "./service-area";`
- `PricingConfig`: add `serviceArea: ServiceAreaConfig;` after `deliveryFeePaise`.
- `Job`: after `deliveryAddress` add
  ```ts
  deliveryPincode: string | null;
  deliveryArea: string | null;
  ```

- [ ] **Step 2: SQLite migrations**

`src/lib/db.ts`:
- `ensureJobColumns` additions: append `['delivery_pincode', 'TEXT'], ['delivery_area', 'TEXT']`.
- `ensurePricingColumns` additions: append `['service_area_config', "TEXT NOT NULL DEFAULT ''"]`.

- [ ] **Step 3: Map + persist**

- Import `parseServiceAreaConfig, serializeServiceAreaConfig` from `./service-area` at top of db.ts.
- `mapJob` (after `deliveryAddress`):
  ```ts
  deliveryPincode: row.delivery_pincode ? String(row.delivery_pincode) : null,
  deliveryArea: row.delivery_area ? String(row.delivery_area) : null,
  ```
- jobData normalization (~line 619 region):
  ```ts
  deliveryPincode: jobData.deliveryPincode ?? jobData.delivery_pincode ?? null,
  deliveryArea: jobData.deliveryArea ?? jobData.delivery_area ?? null,
  ```
- Job INSERT (~line 631): add `delivery_pincode, delivery_area` columns next to `delivery_address` with matching `?` placeholders, bind the two normalized values in the same position.
- `getPricing` SQLite branch: widen `row` type to `Record<string, number | string>` and add
  ```ts
  serviceArea: parseServiceAreaConfig(row.service_area_config as string),
  ```
  (Existing numeric fields: add `as number` casts only where the widened type makes typecheck complain — keep the diff minimal.)
- `updatePricing` SQLite branch: add `service_area_config = ?` to SET list, bind `serializeServiceAreaConfig(pricing.serviceArea)`.

- [ ] **Step 4: Typecheck + tests**

Run: `npm run typecheck` — remaining errors allowed only in files owned by Tasks 3-6 (db-supabase, routes, PricingPanel, UploadForm). Run: `npm run test` — existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/db.ts
git commit -m "feat: add serviceArea config and delivery pincode/area to types and SQLite"
```

---

### Task 3: Supabase layer + SQL migration

**Files:**
- Modify: `src/lib/db-supabase.ts` (PRICING_DEFAULTS ~586, getPricing ~602-617, updatePricing ~624-639, job insert mapping ~361, row→Job mapper)
- Create: migration SQL (follow the project's existing Supabase migration convention; if none in-repo, apply via Supabase MCP `apply_migration` and commit the SQL under `supabase/migrations/`)

**Interfaces:**
- Consumes: Task 1 parse/serialize; Task 2 types.
- Produces: Supabase parity for `serviceArea` / `delivery_pincode` / `delivery_area`.

- [ ] **Step 1: Migration SQL** (name: `service_area_gated_delivery`)

```sql
alter table pricing_config add column if not exists service_area_config text not null default '';
alter table jobs add column if not exists delivery_pincode text;
alter table jobs add column if not exists delivery_area text;
```

Apply to production project (MCP `apply_migration` or dashboard SQL editor). Commit the SQL file.

- [ ] **Step 2: db-supabase.ts changes**

- Import `DEFAULT_SERVICE_AREA, parseServiceAreaConfig, serializeServiceAreaConfig` from `./service-area`.
- `PRICING_DEFAULTS`: add `serviceArea: DEFAULT_SERVICE_AREA`.
- `getPricing` return: add `serviceArea: parseServiceAreaConfig(data.service_area_config),`
- `updatePricing` payload: add `service_area_config: serializeServiceAreaConfig(pricing.serviceArea),`
- Job insert mapping (~361, next to `delivery_address`):
  ```ts
  delivery_pincode: jobData.delivery_pincode ?? jobData.deliveryPincode ?? null,
  delivery_area: jobData.delivery_area ?? jobData.deliveryArea ?? null,
  ```
- Row→Job mapper (find the function producing `Job` — same shape as db.ts `mapJob`):
  ```ts
  deliveryPincode: row.delivery_pincode ? String(row.delivery_pincode) : null,
  deliveryArea: row.delivery_area ? String(row.delivery_area) : null,
  ```

- [ ] **Step 3: Typecheck + tests + commit**

Run: `npm run typecheck` (remaining errors only in Task 4-6 files) && `npm run test` — PASS.

```bash
git add src/lib/db-supabase.ts supabase/migrations
git commit -m "feat: add service area config and delivery pincode/area to Supabase layer"
```

---

### Task 4: Server enforcement in POST /api/jobs + admin pricing route

**Files:**
- Modify: `src/app/api/jobs/route.ts` (parseDeliveryDetails ~46-100, single handler ~234-278, handleBulk ~433-469)
- Modify: `src/app/api/admin/pricing/route.ts`

**Interfaces:**
- Consumes: `isValidPincode`, `checkDeliveryServiceable`, `validateServiceAreaConfig` (Task 1); `pricing.serviceArea` (Tasks 2-3).
- Produces: form fields read: `deliveryPincode`, `deliveryArea` (UploadForm must post these exact names); jobData gains `delivery_pincode`, `delivery_area`; PUT pricing accepts `serviceArea`.

- [ ] **Step 1: parseDeliveryDetails collects pincode + area**

`src/app/api/jobs/route.ts`: import `checkDeliveryServiceable, isValidPincode` from `@/lib/service-area`.
- Pickup branch return: add `deliveryPincode: null, deliveryArea: null,`
- Delivery branch, after the address check:
  ```ts
  const deliveryPincode = String(form.get("deliveryPincode") ?? "").trim();
  if (!isValidPincode(deliveryPincode)) return { error: "Enter a valid 6-digit pincode" } as const;
  const deliveryAreaRaw = String(form.get("deliveryArea") ?? "").trim();
  const deliveryArea = deliveryAreaRaw.length > 0 && deliveryAreaRaw.length <= 60 ? deliveryAreaRaw : null;
  ```
  Include both in the success return object.

- [ ] **Step 2: Serviceability check (single path)**

After `const pricing = await getPricing();` (~line 241):

```ts
if (deliveryMethod === "delivery") {
  const check = checkDeliveryServiceable(
    {
      pincode: deliveryDetails.deliveryPincode,
      area: deliveryDetails.deliveryArea,
      lat: deliveryDetails.deliveryLatitude,
      lng: deliveryDetails.deliveryLongitude,
    },
    pricing.serviceArea
  );
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
}
```

Add to `jobData` next to `delivery_address`:
```ts
delivery_pincode: deliveryDetails.deliveryPincode,
delivery_area: deliveryDetails.deliveryArea,
```

- [ ] **Step 3: Same for handleBulk**

Identical check block after bulk's `const pricing = await getPricing();` (~line 433); same two jobData fields in bulk `jobData`.

- [ ] **Step 4: Admin pricing PUT accepts serviceArea**

`src/app/api/admin/pricing/route.ts`: import `DEFAULT_SERVICE_AREA, validateServiceAreaConfig` from `@/lib/service-area`. After the numeric-field loop:

```ts
let serviceArea = DEFAULT_SERVICE_AREA;
if (body.serviceArea !== undefined) {
  const validated = validateServiceAreaConfig(body.serviceArea);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  serviceArea = validated.config;
}
```

Add `serviceArea` to the `updatePricing({...})` call.

- [ ] **Step 5: Typecheck, test, commit**

Run: `npm run typecheck` && `npm run test`.

```bash
git add src/app/api/jobs/route.ts src/app/api/admin/pricing/route.ts
git commit -m "feat: enforce service-area check for delivery jobs server-side"
```

---

### Task 5: UploadForm — pincode input, area dropdown, GPS requirement, client gate

**Files:**
- Modify: `src/components/pages/UploadForm.tsx` (state ~33-40, location gate ~843, submit validation ~929, form.set block ~408-412, delivery fields UI ~1607-1660, review ~1941-1955, continue-button gating ~1750/~2020)
- Modify: `src/app/styles/base-and-customer.css` (warning style if no existing class fits)

**Interfaces:**
- Consumes: `checkDeliveryServiceable`, `isValidPincode` from `@/lib/service-area`; `pricing.serviceArea` (flows through existing `/api/pricing` fetch automatically — route spreads pricing, no change needed).
- Produces: posts form fields `deliveryPincode` and `deliveryArea` (exact names from Task 4).

- [ ] **Step 1: State + derived check**

```ts
const [deliveryPincode, setDeliveryPincode] = useState("");
const [deliveryArea, setDeliveryArea] = useState("");
```

Derived (near other `useMemo`s; `serviceArea` may be missing on a stale cached pricing response — guard):

```ts
const serviceArea = pricing?.serviceArea ?? null;
const pincodeValid = isValidPincode(deliveryPincode);
const areaOptions = useMemo(() => {
  if (!serviceArea || serviceArea.mode !== "pincode_area") return [];
  return serviceArea.pincodes.find((p) => p.pincode === deliveryPincode)?.areas ?? [];
}, [serviceArea, deliveryPincode]);
const gpsRequired = serviceArea?.mode === "radius" || serviceArea?.mode === "polygon";
const serviceCheck = useMemo(() => {
  if (!serviceArea || !pincodeValid) return { ok: true as const };
  return checkDeliveryServiceable(
    { pincode: deliveryPincode, area: deliveryArea || null, lat: capturedLat, lng: capturedLng },
    serviceArea
  );
}, [serviceArea, pincodeValid, deliveryPincode, deliveryArea, capturedLat, capturedLng]);
```

(`capturedLat`/`capturedLng`: use the component's existing location-capture state variables — find the state feeding `form.set("deliveryLatitude", ...)` and reuse it; pass `null` when not captured.)

Reset `deliveryArea` when pincode changes: in the pincode onChange, also `setDeliveryArea("")`.

- [ ] **Step 2: Post fields**

In the form-building block (~408-412, after `deliveryAddress`):

```ts
form.set("deliveryPincode", deliveryPincode.trim());
if (deliveryArea) form.set("deliveryArea", deliveryArea);
```

- [ ] **Step 3: Gates**

- Location gate (~843): existing check `deliveryMethod === "delivery" && locationState !== "captured"` already forces capture — confirm it blocks when `gpsRequired`; if the current gate is conditional/skippable, make it unskippable when `gpsRequired`.
- Submit validation (~929): extend to require `pincodeValid && serviceCheck.ok && (areaOptions.length === 0 || deliveryArea)`.
- Continue-button/step gating (~1750, ~2020): mirror the same condition wherever delivery-step completeness is computed.

- [ ] **Step 4: UI**

In the delivery details block (~1607-1660, after the address textarea), matching surrounding input markup/classes:

```tsx
<input
  type="text"
  inputMode="numeric"
  maxLength={6}
  placeholder="Pincode (6 digits)"
  value={deliveryPincode}
  onChange={(e) => { setDeliveryPincode(e.target.value.replace(/\D/g, "")); setDeliveryArea(""); }}
  aria-invalid={deliveryPincode.length > 0 && (!pincodeValid || !serviceCheck.ok)}
/>
{areaOptions.length > 0 && (
  <select value={deliveryArea} onChange={(e) => setDeliveryArea(e.target.value)} required>
    <option value="">Select your area…</option>
    {areaOptions.map((a) => <option key={a} value={a}>{a}</option>)}
  </select>
)}
{pincodeValid && !serviceCheck.ok && (
  <p className="delivery-area-warning" role="alert">{(serviceCheck as { ok: false; reason: string }).reason}</p>
)}
```

Add `.delivery-area-warning` to `src/app/styles/base-and-customer.css` if no existing warning class fits (small red text consistent with existing error styles).

- [ ] **Step 5: Review section**

In the delivery review block (~1953), below the address row:

```tsx
<div className="delivery-review-address"><dt>Pincode</dt><dd>{deliveryPincode}{deliveryArea ? ` — ${deliveryArea}` : ""}</dd></div>
```

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` — PASS. Browser verify in Task 7.

```bash
git add src/components/pages/UploadForm.tsx src/app/styles/base-and-customer.css
git commit -m "feat: collect delivery pincode/area and gate by service-area mode in upload form"
```

---

### Task 6: Admin — PricingPanel mode editor + job views

**Files:**
- Modify: `src/components/admin/PricingPanel.tsx`
- Modify: `src/components/admin/JobCard.tsx`, `src/components/pages/JobDetail.tsx`

**Interfaces:**
- Consumes: `ServiceAreaConfig`, `ServiceAreaMode`, `DEFAULT_SERVICE_AREA`, `isValidPincode` (Task 1); `Job.deliveryPincode`/`deliveryArea`.
- Produces: `onSave` payload = `Pricing` including `serviceArea` (shape from Task 1 — matches admin PUT from Task 4).

- [ ] **Step 1: Keep serviceArea out of the numeric draft**

`PricingDraft` maps every `Pricing` key to `number | ""` — the object-valued `serviceArea` breaks `normalizePricingDraft`. Change:

```ts
type NumericPricing = Omit<Pricing, "serviceArea">;
type PricingDraft = { [Key in keyof NumericPricing]: NumericPricing[Key] | "" };
```

`defaultPricing` becomes `NumericPricing` (drop nothing else); wherever a full `Pricing` is needed, spread `{ ...numeric, serviceArea }`.

- [ ] **Step 2: Service-area editor state**

Textarea-free structured-ish editing, kept simple (one text field per concern):

```ts
const initialSA = pricing?.serviceArea ?? DEFAULT_SERVICE_AREA;
const [saMode, setSaMode] = useState<ServiceAreaMode>(initialSA.mode);
// One line per pincode: "713347: Sitarampur, Chelidanga" or bare "713343"
const [saPincodesText, setSaPincodesText] = useState(
  initialSA.pincodes.map((p) => (p.areas.length ? `${p.pincode}: ${p.areas.join(", ")}` : p.pincode)).join("\n")
);
const [saRadius, setSaRadius] = useState(initialSA.radiusKm?.toString() ?? "");
const [saShopLat, setSaShopLat] = useState(initialSA.shopLat?.toString() ?? "");
const [saShopLng, setSaShopLng] = useState(initialSA.shopLng?.toString() ?? "");
// One "lat, lng" per line
const [saPolygonText, setSaPolygonText] = useState(initialSA.polygon.map(([a, b]) => `${a}, ${b}`).join("\n"));
```

Reset all six in the existing `useEffect([pricing])`.

Parse helper inside the component:

```ts
function buildServiceArea(): { config: ServiceAreaConfig } | { error: string } {
  const pincodes: ServiceAreaConfig["pincodes"] = [];
  for (const line of saPincodesText.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [pinPart, areaPart] = line.split(":");
    const pincode = pinPart.trim();
    if (!isValidPincode(pincode)) return { error: `Invalid pincode: "${pincode}" — must be 6 digits` };
    const areas = (areaPart ?? "").split(",").map((a) => a.trim()).filter(Boolean);
    pincodes.push({ pincode, areas });
  }
  const polygon: Array<[number, number]> = [];
  for (const line of saPolygonText.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [latS, lngS] = line.split(",");
    const lat = Number(latS); const lng = Number(lngS);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: `Invalid polygon line: "${line}" — use "lat, lng"` };
    polygon.push([lat, lng]);
  }
  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
  const radiusKm = numOrNull(saRadius); const shopLat = numOrNull(saShopLat); const shopLng = numOrNull(saShopLng);
  if ((radiusKm !== null && !(radiusKm > 0)) ||
      (shopLat !== null && !(shopLat >= -90 && shopLat <= 90)) ||
      (shopLng !== null && !(shopLng >= -180 && shopLng <= 180))) {
    return { error: "Invalid radius or shop coordinates" };
  }
  return { config: { mode: saMode, pincodes, radiusKm, shopLat, shopLng, polygon } };
}
```

In `handleSave`: `const sa = buildServiceArea(); if ("error" in sa) { setError(sa.error); return; }` then `await onSave({ ...nextPricing, serviceArea: sa.config });`

- [ ] **Step 3: Editor UI**

New `<section className="pricing-section">` "Delivery Area" before the footer, mirroring existing section markup:

- Mode `<select>` with the five options, human labels: "No restriction", "By pincode", "By pincode + area", "By distance (radius)", "By map boundary (polygon)".
- Shown conditionally by `saMode`:
  - `pincode` / `pincode_area`: `<textarea>` bound to `saPincodesText`, hint: `pincode_area` → `One per line: 713347: Sitarampur, Chelidanga (areas optional — bare pincode = whole pincode)`; `pincode` hint: `One 6-digit pincode per line`.
  - `radius`: three inputs — radius km, shop latitude, shop longitude — bound to `saRadius`/`saShopLat`/`saShopLng`, hint: `Get shop lat/lng from Google Maps (right-click your shop → copy coordinates)`.
  - `polygon`: `<textarea>` bound to `saPolygonText`, hint: `One corner per line as "lat, lng"; at least 3 lines. Right-click points on Google Maps to copy coordinates.`
- Every onChange also `setSaved(false); setError("");` (matches existing fields).

- [ ] **Step 4: Job views**

`JobCard.tsx` + `JobDetail.tsx`: where `deliveryAddress` renders, append when present (match each component's markup style):

```tsx
{job.deliveryPincode ? ` — ${job.deliveryPincode}` : ""}{job.deliveryArea ? ` (${job.deliveryArea})` : ""}
```

- [ ] **Step 5: Typecheck + full tests + commit**

Run: `npm run typecheck` && `npm run test` — zero errors now, full suite green.

```bash
git add src/components/admin/PricingPanel.tsx src/components/admin/JobCard.tsx src/components/pages/JobDetail.tsx
git commit -m "feat: admin service-area mode editor and job pincode/area display"
```

---

### Task 7: End-to-end verification (dev server)

**Files:** none (verification only).

- [ ] **Step 1:** Start dev server (preview/launch config), open `/admin` → Pricing → "Delivery Area".
- [ ] **Step 2 — pincode mode:** select "By pincode", enter `713347`, save. Customer flow: delivery + pincode `560001` → inline pincode rejection, submit blocked; pincode `713347` → submits, token screen shows.
- [ ] **Step 3 — pincode_area mode:** switch mode, line `713347: Sitarampur`, save. Customer: pincode `713347` → area dropdown appears; no area → blocked; select `Sitarampur` → submits.
- [ ] **Step 4 — radius mode:** switch mode, radius `5`, shop lat/lng of your shop, save. Customer: delivery requires location capture; simulate far coordinates (devtools sensor override) → out-of-area message; near coordinates → submits.
- [ ] **Step 5 — server enforcement:** re-send a captured `POST /api/jobs` with unserviceable values (devtools "Edit and resend"/curl) → 400 with the evaluator's reason copy.
- [ ] **Step 6 — persistence:** re-open PricingPanel after each save — mode + fields restored; switch modes back and forth — no data loss.
- [ ] **Step 7 — off mode regression:** set "No restriction", save; any pincode accepted, no dropdown, GPS optional again.
- [ ] **Step 8 — admin job view:** delivery job shows `address — pincode (area)`.
- [ ] **Step 9:** `npm run typecheck` && `npm run test` green; commit any fixes.
