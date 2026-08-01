# Pincode-Gated Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict home delivery to an admin-managed allowlist of 6-digit pincodes; pickup unaffected.

**Architecture:** New pure helper module `src/lib/pincode.ts` (parse/validate/membership). `service_pincodes` comma-separated TEXT column on `pricing_config`, `delivery_pincode` TEXT on `jobs` — dual migrations (SQLite auto-migrate + Supabase SQL). Server enforcement in `POST /api/jobs` (both single and bulk paths). Client UX in UploadForm; admin editor in PricingPanel. Empty allowlist = delivery available everywhere.

**Tech Stack:** Next.js 15 App Router, TypeScript, better-sqlite3 + Supabase dual DB, vitest.

## Global Constraints

- Pincode format: exactly 6 digits, first digit non-zero (`/^[1-9]\d{5}$/`) — Indian pincode rule.
- Empty/unset allowlist means delivery allowed for any valid pincode (spec: backward compatible).
- Server is the enforcement point; client checks are UX only.
- Error copy (verbatim): `"Delivery is not available for this pincode yet — please choose pickup"`.
- Storage format: comma-separated string in DB, `string[]` in `PricingConfig.servicePincodes`.
- Run `npm run typecheck` and `npm run test` before each commit.

---

### Task 1: Pincode helper module

**Files:**
- Create: `src/lib/pincode.ts`
- Test: `src/lib/pincode.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (later tasks rely on these exact signatures):
  - `isValidPincode(value: string): boolean`
  - `parsePincodeList(raw: string | null | undefined): string[]` — splits on commas/whitespace, trims, drops invalid, dedupes, preserves order.
  - `serializePincodeList(pincodes: string[]): string` — valid + deduped, comma-joined.
  - `isPincodeServiceable(pincode: string, servicePincodes: string[]): boolean` — `true` when list empty.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pincode.test.ts
import { describe, expect, it } from "vitest";
import { isPincodeServiceable, isValidPincode, parsePincodeList, serializePincodeList } from "./pincode";

describe("isValidPincode", () => {
  it("accepts a 6-digit pincode not starting with 0", () => {
    expect(isValidPincode("713347")).toBe(true);
  });
  it.each(["01334", "0133471", "71334", "7133477", "71334a", "", " 713347"])(
    "rejects %j",
    (value) => expect(isValidPincode(value)).toBe(false)
  );
});

describe("parsePincodeList", () => {
  it("splits, trims, dedupes, drops invalid", () => {
    expect(parsePincodeList(" 713347, 713343 ,713347, abc, 713339 ")).toEqual([
      "713347", "713343", "713339",
    ]);
  });
  it("returns [] for null, undefined, and empty string", () => {
    expect(parsePincodeList(null)).toEqual([]);
    expect(parsePincodeList(undefined)).toEqual([]);
    expect(parsePincodeList("")).toEqual([]);
  });
});

describe("serializePincodeList", () => {
  it("joins valid deduped pincodes with commas", () => {
    expect(serializePincodeList(["713347", "bad", "713343", "713347"])).toBe("713347,713343");
  });
});

describe("isPincodeServiceable", () => {
  it("allows any pincode when the list is empty", () => {
    expect(isPincodeServiceable("999999", [])).toBe(true);
  });
  it("allows a listed pincode", () => {
    expect(isPincodeServiceable("713347", ["713347", "713343"])).toBe(true);
  });
  it("rejects an unlisted pincode", () => {
    expect(isPincodeServiceable("560001", ["713347"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/pincode.test.ts`
Expected: FAIL — cannot resolve `./pincode`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/pincode.ts
// Indian pincodes: exactly 6 digits, never starting with 0.
const PINCODE_RE = /^[1-9]\d{5}$/;

export function isValidPincode(value: string): boolean {
  return PINCODE_RE.test(value);
}

// DB stores the allowlist as a comma-separated string; parse defensively so a
// hand-edited value (spaces, stray entries) can't break the check.
export function parsePincodeList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,]+/).map((p) => p.trim()).filter(isValidPincode))];
}

export function serializePincodeList(pincodes: string[]): string {
  return [...new Set(pincodes.filter(isValidPincode))].join(",");
}

// Empty allowlist = not configured yet = delivery open everywhere.
export function isPincodeServiceable(pincode: string, servicePincodes: string[]): boolean {
  if (servicePincodes.length === 0) return true;
  return servicePincodes.includes(pincode);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/pincode.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pincode.ts src/lib/pincode.test.ts
git commit -m "feat: add pincode parse/validate helpers for delivery gating"
```

---

### Task 2: Types + SQLite layer

**Files:**
- Modify: `src/lib/types.ts` (PricingConfig ~line 119-134, Job ~line 68-86)
- Modify: `src/lib/db.ts` (ensureJobColumns ~181, ensurePricingColumns ~225, mapJob ~299-313, createJob/createJobWithFiles camelCase mapping ~619, INSERT statements ~631, getPricing ~836, updatePricing ~855)

**Interfaces:**
- Consumes: `parsePincodeList`, `serializePincodeList` from `src/lib/pincode.ts` (Task 1).
- Produces: `PricingConfig.servicePincodes: string[]`; `Job.deliveryPincode: string | null`; `createJob`/`createJobWithFiles` accept `delivery_pincode` in jobData.

- [ ] **Step 1: Extend types**

In `src/lib/types.ts`:
- `PricingConfig`: add `servicePincodes: string[];` after `deliveryFeePaise`.
- `Job`: add `deliveryPincode: string | null;` after `deliveryAddress`.

- [ ] **Step 2: SQLite migrations**

In `src/lib/db.ts`:
- `ensureJobColumns` additions array: append `['delivery_pincode', 'TEXT']`.
- `ensurePricingColumns` additions array: append `['service_pincodes', "TEXT NOT NULL DEFAULT ''"]`.

- [ ] **Step 3: Map + persist**

- `mapJob`: after `deliveryAddress` line add
  ```ts
  deliveryPincode: row.delivery_pincode ? String(row.delivery_pincode) : null,
  ```
- In the jobData normalization object (~line 619 region) add
  ```ts
  deliveryPincode: jobData.deliveryPincode ?? jobData.delivery_pincode ?? null,
  ```
- Add `delivery_pincode` to the INSERT column list(s) and corresponding value bindings for the job insert used by `createJob`/`createJobWithFiles` (there is a shared insert around line 631 — add the column next to `delivery_address` and bind `deliveryPincode`).
- `getPricing` (SQLite branch): import `parsePincodeList` at top of db.ts; add
  ```ts
  servicePincodes: parsePincodeList(row.service_pincodes as unknown as string),
  ```
  Note: `row` is typed `Record<string, number>`; cast as shown or widen the type to `Record<string, number | string>`.
- `updatePricing` (SQLite branch): add `service_pincodes = ?` to the UPDATE SET list and bind `serializePincodeList(pricing.servicePincodes)` (import from pincode.ts).

- [ ] **Step 4: Typecheck + tests**

Run: `npm run typecheck` — expect errors ONLY in `db-supabase.ts`/`PricingPanel.tsx`/routes not yet updated; if `PRICING_DEFAULTS` in db-supabase errors, that's Task 3. If typecheck is too noisy to be useful mid-change, proceed to Task 3 then run.
Run: `npm run test` — existing tests must still pass.

- [ ] **Step 5: Commit (may fold into Task 3 commit if typecheck blocks)**

```bash
git add src/lib/types.ts src/lib/db.ts
git commit -m "feat: add servicePincodes and deliveryPincode to types and SQLite layer"
```

---

### Task 3: Supabase layer + SQL migration

**Files:**
- Modify: `src/lib/db-supabase.ts` (PRICING_DEFAULTS ~586, getPricing ~602-617, updatePricing ~624-639, job insert mapping ~361)
- Create: `supabase/migrations/<timestamp>_pincode_gated_delivery.sql` (follow existing migrations dir naming; if project keeps migrations elsewhere, match it)

**Interfaces:**
- Consumes: `parsePincodeList`, `serializePincodeList` (Task 1); types from Task 2.
- Produces: Supabase parity for `servicePincodes` / `delivery_pincode`.

- [ ] **Step 1: Migration SQL**

```sql
alter table pricing_config add column if not exists service_pincodes text not null default '';
alter table jobs add column if not exists delivery_pincode text;
```

Apply to the production project via Supabase MCP `apply_migration` (name: `pincode_gated_delivery`) or dashboard SQL editor. Commit the SQL file either way.

- [ ] **Step 2: db-supabase.ts changes**

- Import `parsePincodeList`, `serializePincodeList` from `./pincode`.
- `PRICING_DEFAULTS`: add `servicePincodes: []`.
- `getPricing` return object: add
  ```ts
  servicePincodes: parsePincodeList(data.service_pincodes),
  ```
- `updatePricing` update payload: add
  ```ts
  service_pincodes: serializePincodeList(pricing.servicePincodes),
  ```
- Job insert mapping (~line 361, next to `delivery_address`): add
  ```ts
  delivery_pincode: jobData.delivery_pincode ?? jobData.deliveryPincode ?? null,
  ```
- Job row→Job mapper in db-supabase (find the function mapping rows to `Job` — same shape as db.ts `mapJob`): add
  ```ts
  deliveryPincode: row.delivery_pincode ? String(row.delivery_pincode) : null,
  ```

- [ ] **Step 3: Typecheck + tests**

Run: `npm run typecheck` — remaining errors should now only be UI/routes (fixed in Tasks 4-6); if zero, better.
Run: `npm run test` — PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db-supabase.ts supabase/migrations
git commit -m "feat: add service_pincodes and delivery_pincode to Supabase layer"
```

---

### Task 4: Server enforcement in POST /api/jobs + admin pricing route

**Files:**
- Modify: `src/app/api/jobs/route.ts` (parseDeliveryDetails ~46-100, single handler ~234-278, handleBulk ~433-469)
- Modify: `src/app/api/admin/pricing/route.ts`
- Test: `src/lib/pincode.test.ts` already covers logic; route-level behavior verified manually in Task 7.

**Interfaces:**
- Consumes: `isValidPincode`, `isPincodeServiceable` (Task 1); `pricing.servicePincodes` (Tasks 2-3).
- Produces: jobData gains `delivery_pincode`; 400 rejections per Global Constraints copy.

- [ ] **Step 1: parseDeliveryDetails collects pincode**

In `src/app/api/jobs/route.ts`, import `isValidPincode, isPincodeServiceable` from `@/lib/pincode`. In `parseDeliveryDetails`:
- pickup branch: add `deliveryPincode: null,` to the returned object.
- delivery branch, after the address check:
  ```ts
  const deliveryPincode = String(form.get("deliveryPincode") ?? "").trim();
  if (!isValidPincode(deliveryPincode)) return { error: "Enter a valid 6-digit pincode" } as const;
  ```
  and include `deliveryPincode` in the success return object.

- [ ] **Step 2: Serviceability check (single path)**

After `const pricing = await getPricing();` (~line 241) add:

```ts
if (deliveryMethod === "delivery" && deliveryDetails.deliveryPincode &&
    !isPincodeServiceable(deliveryDetails.deliveryPincode, pricing.servicePincodes)) {
  return NextResponse.json(
    { error: "Delivery is not available for this pincode yet — please choose pickup" },
    { status: 400 }
  );
}
```

Add to `jobData` (next to `delivery_address`): `delivery_pincode: deliveryDetails.deliveryPincode,`

- [ ] **Step 3: Same for handleBulk**

After `const pricing = await getPricing();` (~line 433) insert the identical serviceability block, and add `delivery_pincode: deliveryDetails.deliveryPincode,` to bulk `jobData`.

- [ ] **Step 4: Admin pricing PUT accepts servicePincodes**

In `src/app/api/admin/pricing/route.ts`, import `isValidPincode` from `@/lib/pincode`. After the numeric-field loop add:

```ts
const servicePincodes: string[] = Array.isArray(body.servicePincodes) ? body.servicePincodes : [];
for (const pin of servicePincodes) {
  if (typeof pin !== "string" || !isValidPincode(pin)) {
    return NextResponse.json({ error: `Invalid pincode: ${String(pin)}` }, { status: 400 });
  }
}
```

Add `servicePincodes` to the `updatePricing({...})` call.

- [ ] **Step 5: Typecheck, test, commit**

Run: `npm run typecheck` && `npm run test` — expect PASS (UI errors, if any, belong to Tasks 5-6).

```bash
git add src/app/api/jobs/route.ts src/app/api/admin/pricing/route.ts
git commit -m "feat: enforce serviceable pincode for delivery jobs server-side"
```

---

### Task 5: UploadForm pincode field + client gate

**Files:**
- Modify: `src/components/pages/UploadForm.tsx` (state ~33-40, submit guards ~843/~929, form.set block ~408-412, delivery fields UI ~1607-1660, review section ~1941-1955, step-gating `deliveryMethod === "delivery"` conditions ~1750/~2020)

**Interfaces:**
- Consumes: `isValidPincode`, `isPincodeServiceable` from `@/lib/pincode`; `pricing.servicePincodes` via existing `/api/pricing` fetch (route spreads pricing — field flows automatically, no route change needed).
- Produces: form field `deliveryPincode` posted with delivery jobs (name must match Task 4 exactly).

- [ ] **Step 1: State + derived flags**

```ts
const [deliveryPincode, setDeliveryPincode] = useState("");
```

Near other `useMemo`s:

```ts
const pincodeValid = isValidPincode(deliveryPincode);
const pincodeServiceable =
  !pincodeValid || !pricing ? true : isPincodeServiceable(deliveryPincode, pricing.servicePincodes ?? []);
```

(`?? []` guards a stale cached /api/pricing response without the field.)

- [ ] **Step 2: Post the field**

In the form-building block (~line 408-412, after `form.set("deliveryAddress", ...)`):

```ts
form.set("deliveryPincode", deliveryPincode.trim());
```

- [ ] **Step 3: Submit guards**

Extend the existing delivery validation (~line 929) from name/phone/address to also require `pincodeValid && pincodeServiceable`. Mirror any earlier step-gating check (~line 843 region / continue-button disabled conditions ~1750, ~2020) the same way so the customer can't advance with a bad pincode.

- [ ] **Step 4: UI input + inline notice**

In the delivery details block (~line 1607-1660, next to the address textarea) add:

```tsx
<input
  type="text"
  inputMode="numeric"
  maxLength={6}
  placeholder="Pincode (6 digits)"
  value={deliveryPincode}
  onChange={(e) => setDeliveryPincode(e.target.value.replace(/\D/g, ""))}
  aria-invalid={deliveryPincode.length > 0 && (!pincodeValid || !pincodeServiceable)}
/>
{pincodeValid && !pincodeServiceable && (
  <p className="delivery-pincode-warning" role="alert">
    Delivery not available for {deliveryPincode} yet — pickup only. Switch to pickup to continue.
  </p>
)}
```

Match surrounding class names/markup conventions in that block (reuse existing input classes). Add a minimal `.delivery-pincode-warning` style in the stylesheet that holds the other delivery styles (`src/app/styles/base-and-customer.css`) if no suitable class exists.

- [ ] **Step 5: Review section**

In the delivery review block (~line 1953) add below the address row:

```tsx
<div className="delivery-review-address"><dt>Pincode</dt><dd>{deliveryPincode}</dd></div>
```

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck` — PASS. Browser-verify in Task 7.

```bash
git add src/components/pages/UploadForm.tsx src/app/styles/base-and-customer.css
git commit -m "feat: collect and gate delivery pincode in upload form"
```

---

### Task 6: Admin — PricingPanel editor + job views

**Files:**
- Modify: `src/components/admin/PricingPanel.tsx`
- Modify: `src/components/admin/JobCard.tsx`, `src/components/pages/JobDetail.tsx` (show pincode with delivery address)

**Interfaces:**
- Consumes: `parsePincodeList` from `@/lib/pincode`; `PricingConfig.servicePincodes`; `Job.deliveryPincode`.
- Produces: `onSave` payload includes `servicePincodes: string[]`.

- [ ] **Step 1: PricingPanel state**

`PricingDraft` maps every key to `Pricing[Key] | ""` — the new `servicePincodes: string[]` key makes `normalizePricingDraft`'s all-numeric check wrong. Keep pincodes OUT of the draft:

- Change `PricingDraft` to `{ [Key in keyof Omit<Pricing, "servicePincodes">]: ... }` and `defaultPricing` stays without `servicePincodes` by typing it `Omit<Pricing, "servicePincodes">` (add `servicePincodes: []` where a full `Pricing` is required).
- New state: `const [pincodesInput, setPincodesInput] = useState((pricing?.servicePincodes ?? []).join(", "));` and reset it in the existing `useEffect([pricing])`.
- In `handleSave`, build `servicePincodes: parsePincodeList(pincodesInput)` and pass `{ ...nextPricing, servicePincodes }` to `onSave`. If the input has non-empty tokens that parse away (invalid), set error `"Pincodes must be 6 digits, comma-separated."` and abort save:
  ```ts
  const tokens = pincodesInput.split(/[\s,]+/).filter(Boolean);
  const servicePincodes = parsePincodeList(pincodesInput);
  if (tokens.length !== servicePincodes.length) { setError("Pincodes must be 6 digits, comma-separated."); return; }
  ```
  (Note: dedupe can also shrink the list — acceptable; if you want exactness, compare against `new Set(tokens)` size only when all tokens are valid.)

- [ ] **Step 2: PricingPanel UI**

New section before the footer (mirror existing section markup):

```tsx
<section className="pricing-section">
  <h3>Delivery Area</h3>
  <div className="pricing-grid single">
    <div className="pricing-field">
      <label>Serviceable pincodes</label>
      <input
        type="text"
        placeholder="e.g. 713347, 713343"
        value={pincodesInput}
        onChange={(e) => { setPincodesInput(e.target.value); setSaved(false); setError(""); }}
      />
      <span className="pricing-hint">
        Comma-separated 6-digit pincodes where home delivery is offered. Leave empty to allow delivery everywhere.
      </span>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Show pincode on jobs**

In `JobCard.tsx` and `JobDetail.tsx`, find where `deliveryAddress` renders and append the pincode when present, e.g. `{job.deliveryAddress}{job.deliveryPincode ? ` — ${job.deliveryPincode}` : ""}` (match each component's existing markup style).

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck` && `npm run test` — PASS (full suite, zero errors now).

```bash
git add src/components/admin/PricingPanel.tsx src/components/admin/JobCard.tsx src/components/pages/JobDetail.tsx
git commit -m "feat: admin pincode allowlist editor and job pincode display"
```

---

### Task 7: End-to-end verification (dev server)

**Files:** none (verification only).

- [ ] **Step 1: Start dev server** (`npm run dev` via preview/launch config), open `/`.
- [ ] **Step 2: Admin sets allowlist** — `/admin` → Pricing → enter one pincode (e.g. `713347`), save; re-open panel, value persisted.
- [ ] **Step 3: Customer blocked path** — upload file, choose Home delivery, enter pincode `560001`: inline warning shows, cannot submit.
- [ ] **Step 4: Customer allowed path** — change pincode to `713347`: warning clears, job submits; token screen shows.
- [ ] **Step 5: Server enforcement** — POST to `/api/jobs` with an unserviceable `deliveryPincode` directly (curl/devtools re-send) → 400 with the exact error copy.
- [ ] **Step 6: Admin job view** — job shows address with pincode.
- [ ] **Step 7: Empty-list regression** — clear allowlist, save; any valid pincode accepted.
- [ ] **Step 8: Final** — `npm run typecheck` && `npm run test` green; commit any fixes.
