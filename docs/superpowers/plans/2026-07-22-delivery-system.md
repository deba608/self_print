# Delivery System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer choose "Home Delivery" (with a flat fee, paid online upfront via the already-built Razorpay integration) instead of shop-counter pickup, and let shop staff manage delivery orders from a separate admin view through to hand-off.

**Architecture:** Add nullable delivery fields to the existing `jobs` table and a flat `deliveryFeePaise` to `pricing_config`. The customer upload form (`UploadForm.tsx`) gains a pickup/delivery toggle that, when set to delivery, collects name/phone/address and forces the existing (currently-dormant) Razorpay checkout path instead of the pay-at-counter option. Admin (`AdminDashboard.tsx`, `JobDetail.tsx`) gains a Pickup/Delivery filter and, for delivery jobs, two new one-way status buttons ("Mark Out for Delivery", "Mark Delivered") backed by a new `deliveryStatus` column and a new `/api/admin/jobs/[id]/delivery-status` endpoint — kept separate from the existing print-progress `status` column, exactly as payment (`paidAt`) is already kept separate from it.

**Tech Stack:** Next.js 15 API routes, SQLite (`better-sqlite3`) for local dev, Supabase (Postgres) for production — both behind the existing `src/lib/db.ts` router — React 19 client components, Razorpay Standard Checkout (already integrated, currently inert because `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` are unset).

## Global Constraints

- Pickup orders must show zero behavior change: no new required fields, same anonymous token flow, same pay-at-counter screen. Every task below must gate new behavior behind `deliveryMethod === "delivery"`.
- `jobs.price_paise` keeps meaning "total amount owed" (unchanged contract — payment routes already charge exactly this). `delivery_fee_paise` is stored separately purely as a breakdown/audit field; it is never re-derived at payment time.
- All new `jobs`/`pricing_config` columns must be nullable or have a `DEFAULT`, added via the existing `ensureJobColumns`/`ensurePricingColumns` migration pattern (SQLite) and raw `ALTER TABLE` (Supabase) — never a destructive schema change.
- Follow the existing dual-backend router pattern in `src/lib/db.ts`: every new/changed function checks `isSupabase` and delegates to `src/lib/db-supabase.ts`, otherwise runs the SQLite path.
- Bulk multi-file upload (`handleBulk` in `src/app/api/jobs/route.ts`, bulk UI in `UploadForm.tsx`) is out of scope — delivery only applies to the single-file upload path.
- No third-party courier integration, no distance/zone pricing, no delivery-staff assignment, no COD — flat fee, online-payment-only, single shared delivery queue (all confirmed in the spec at `docs/superpowers/specs/2026-07-22-delivery-system-design.md`).

---

## Task 1: Schema — `jobs` delivery columns + `pricing_config.deliveryFeePaise`

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db.ts:161-203` (`ensureJobColumns`, `ensurePricingColumns`)
- Modify: Supabase production schema (via `mcp__supabase__execute_sql`, since this project's `.env` has `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set — Supabase is live, not just SQLite)

**Interfaces:**
- Produces: `Job.deliveryMethod: "pickup" | "delivery"`, `Job.customerName: string | null`, `Job.customerPhone: string | null`, `Job.deliveryAddress: string | null`, `Job.deliveryFeePaise: number`, `Job.deliveryStatus: "pending" | "out_for_delivery" | "delivered" | null`, `PricingConfig.deliveryFeePaise: number` — every later task reads/writes these exact names.

- [ ] **Step 1: Add the new fields to the `Job` and `PricingConfig` types**

In `src/lib/types.ts`, add a `DeliveryMethod`/`DeliveryStatus` type alias and extend `Job`:

```typescript
export type DeliveryMethod = "pickup" | "delivery";
export type DeliveryStatus = "pending" | "out_for_delivery" | "delivered";
```

Add this line after `export type FileKind = ...` (line 16).

In the `Job` type (currently `src/lib/types.ts:18-46`), add these fields right after `issueResolvedAt: string | null;` (line 43), before `file?: JobFile;`:

```typescript
  deliveryMethod: DeliveryMethod;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryFeePaise: number;
  deliveryStatus: DeliveryStatus | null;
```

In `PricingConfig` (currently `src/lib/types.ts:60-74`), add after `expiryMinutes: number;`:

```typescript
  deliveryFeePaise: number;
```

- [ ] **Step 2: Add SQLite migration columns**

In `src/lib/db.ts`, inside `ensureJobColumns` (the `additions` array at lines 165-176), add:

```typescript
    ['delivery_method', "TEXT NOT NULL DEFAULT 'pickup'"],
    ['customer_name', 'TEXT'],
    ['customer_phone', 'TEXT'],
    ['delivery_address', 'TEXT'],
    ['delivery_fee_paise', 'INTEGER NOT NULL DEFAULT 0'],
    ['delivery_status', 'TEXT']
```

Inside `ensurePricingColumns` (the `additions` array at lines 190-197), add:

```typescript
    ['delivery_fee_paise', 'INTEGER NOT NULL DEFAULT 0']
```

- [ ] **Step 3: Verify SQLite migration runs cleanly**

Run: `npm run db:seed`
Expected: completes with no errors (script re-runs `ensureJobColumns`/`ensurePricingColumns`, which use `ALTER TABLE ... ADD COLUMN` guarded by a column-existence check, so this is safe to run against the existing local `data/selfprint.sqlite`).

Then check the columns landed:
```bash
node -e "const db=require('better-sqlite3')('data/selfprint.sqlite'); console.log(db.prepare('PRAGMA table_info(jobs)').all().map(c=>c.name).filter(n=>n.startsWith('delivery')||n.startsWith('customer'))); console.log(db.prepare('PRAGMA table_info(pricing_config)').all().map(c=>c.name).filter(n=>n.startsWith('delivery')));"
```
Expected output includes: `delivery_method`, `customer_name`, `customer_phone`, `delivery_address`, `delivery_fee_paise`, `delivery_status` (jobs) and `delivery_fee_paise` (pricing_config).

- [ ] **Step 4: Apply the same migration to the production Supabase database**

This project's `.env` has `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set, so Supabase is the live backend — it needs the same columns, added directly (there is no separate "Supabase migrations" tooling wired up in this repo; `db-supabase.ts` assumes the table already has the right shape). Run via `mcp__supabase__execute_sql`:

```sql
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'pickup',
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_fee_paise INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT;

ALTER TABLE pricing_config
  ADD COLUMN IF NOT EXISTS delivery_fee_paise INTEGER NOT NULL DEFAULT 0;
```

Expected: both statements succeed with no error. Verify with:
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' AND column_name LIKE 'delivery%' OR column_name LIKE 'customer%';
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/db.ts
git commit -m "feat: add delivery schema fields to jobs and pricing_config"
```

---

## Task 2: `db.ts` / `db-supabase.ts` — mapping, job creation, pricing, delivery-status update

**Files:**
- Modify: `src/lib/db.ts:232-262` (`mapJob`), `:478-545` (`createJobWithFiles`), `:670-723` (`getPricing`/`updatePricing`)
- Modify: `src/lib/db-supabase.ts:17-48` (`mapJob`), `:228-286` (`createJobWithFiles`), `:436-505` (`PRICING_DEFAULTS`/`getPricing`/`updatePricing`)
- Modify: both files — add a new `updateDeliveryStatus` function (router in `db.ts`, implementation in `db-supabase.ts` + SQLite branch in `db.ts`)

**Interfaces:**
- Consumes: `Job`, `PricingConfig`, `DeliveryStatus` from Task 1.
- Produces: `createJobWithFiles(jobData, filesData)` now accepts `deliveryMethod`, `customerName`, `customerPhone`, `deliveryAddress`, `deliveryFeePaise` on `jobData` (all optional — default to pickup/null/0). `updateDeliveryStatus(id: string, deliveryStatus: DeliveryStatus): Promise<void>` — new exported function later tasks call.

- [ ] **Step 1: Update SQLite `mapJob` in `db.ts`**

In `src/lib/db.ts`, in `mapJob` (lines 232-262), add before the closing `};` (after `issueResolvedAt: ...` on line 260):

```typescript
    deliveryMethod: (row.delivery_method ?? 'pickup') as Job['deliveryMethod'],
    customerName: row.customer_name ? String(row.customer_name) : null,
    customerPhone: row.customer_phone ? String(row.customer_phone) : null,
    deliveryAddress: row.delivery_address ? String(row.delivery_address) : null,
    deliveryFeePaise: Number(row.delivery_fee_paise ?? 0),
    deliveryStatus: row.delivery_status ? (row.delivery_status as Job['deliveryStatus']) : null
```

- [ ] **Step 2: Update Supabase `mapJob` in `db-supabase.ts`**

In `src/lib/db-supabase.ts`, in `mapJob` (lines 17-48), add before the closing `};` (after `issueResolvedAt: ...` on line 46):

```typescript
    deliveryMethod: (row.delivery_method ?? 'pickup') as Job['deliveryMethod'],
    customerName: row.customer_name ? String(row.customer_name) : null,
    customerPhone: row.customer_phone ? String(row.customer_phone) : null,
    deliveryAddress: row.delivery_address ? String(row.delivery_address) : null,
    deliveryFeePaise: Number(row.delivery_fee_paise ?? 0),
    deliveryStatus: row.delivery_status ? (row.delivery_status as Job['deliveryStatus']) : null
```

- [ ] **Step 3: Insert the new fields on job creation (SQLite)**

In `src/lib/db.ts`, in `createJobWithFiles` (lines 478-545):

Extend the `j` object (lines 493-508) — add after `queuePosition: jobData.queuePosition ?? jobData.queue_position,`:

```typescript
    deliveryMethod: jobData.deliveryMethod ?? jobData.delivery_method ?? 'pickup',
    customerName: jobData.customerName ?? jobData.customer_name ?? null,
    customerPhone: jobData.customerPhone ?? jobData.customer_phone ?? null,
    deliveryAddress: jobData.deliveryAddress ?? jobData.delivery_address ?? null,
    deliveryFeePaise: jobData.deliveryFeePaise ?? jobData.delivery_fee_paise ?? 0,
```

Update the `INSERT INTO jobs` statement (lines 513-516) to:

```typescript
    sqlite.prepare(`
      INSERT INTO jobs (id, token, status, print_type, copies, page_range, paper_size, layout, pages_per_sheet, margins, scale, duplex, page_count, price_paise, needs_conversion, queue_position, delivery_method, customer_name, customer_phone, delivery_address, delivery_fee_paise, created_at, updated_at)
      VALUES (?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, j.token, j.printType, j.copies, j.pageRange, j.paperSize, j.layout, j.pagesPerSheet, j.margins, j.scale, j.duplex, j.pageCount, j.pricePaise, j.needsConversion, j.queuePosition, j.deliveryMethod, j.customerName, j.customerPhone, j.deliveryAddress, j.deliveryFeePaise, now, now);
```

- [ ] **Step 4: Insert the new fields on job creation (Supabase)**

In `src/lib/db-supabase.ts`, in `createJobWithFiles` (lines 228-286), extend `normalizedJobData` (lines 233-249) — add after `queue_position: jobData.queue_position ?? jobData.queuePosition,`:

```typescript
    delivery_method: jobData.delivery_method ?? jobData.deliveryMethod ?? 'pickup',
    customer_name: jobData.customer_name ?? jobData.customerName ?? null,
    customer_phone: jobData.customer_phone ?? jobData.customerPhone ?? null,
    delivery_address: jobData.delivery_address ?? jobData.deliveryAddress ?? null,
    delivery_fee_paise: jobData.delivery_fee_paise ?? jobData.deliveryFeePaise ?? 0,
```

No other change needed in this function — the `.insert([{ id: jobId, ...normalizedJobData, ... }])` already spreads every key.

- [ ] **Step 5: Add `deliveryFeePaise` to pricing read/write (SQLite)**

In `src/lib/db.ts`:
- In `getPricing()` (lines 670-698), add to the `pricingCache = { ... }` object (after `expiryMinutes: row.expiry_minutes ?? 1440`):
```typescript
    deliveryFeePaise: row.delivery_fee_paise ?? 0
```
- In `updatePricing()` (lines 700-723), add `delivery_fee_paise = ?,` to the `SET` clause and `pricing.deliveryFeePaise,` to the parameter list (immediately after `expiry_minutes = ?` / `pricing.expiryMinutes`).

- [ ] **Step 6: Add `deliveryFeePaise` to pricing read/write (Supabase)**

In `src/lib/db-supabase.ts`:
- In `PRICING_DEFAULTS` (lines 436-450), add `deliveryFeePaise: 0,`.
- In `getPricing()` (lines 452-480), add `deliveryFeePaise: data.delivery_fee_paise ?? PRICING_DEFAULTS.deliveryFeePaise,`.
- In `updatePricing()` (lines 482-505), add `delivery_fee_paise: pricing.deliveryFeePaise,` to the `.update({ ... })` object.

- [ ] **Step 7: Add `updateDeliveryStatus` — router in `db.ts`**

In `src/lib/db.ts`, add this new exported function directly after `updateJobStatus` (after line 582):

```typescript
// Delivery hand-off status, tracked independently of the print-progress
// `status` column — mirrors how `paidAt` is decoupled from `status`. Only
// ever set on delivery-method jobs; the API route enforces that.
export async function updateDeliveryStatus(id: string, deliveryStatus: "out_for_delivery" | "delivered"): Promise<void> {
  if (isSupabase) {
    const mod = await import('./db-supabase');
    return mod.updateDeliveryStatus(id, deliveryStatus);
  }

  const crypto = await import('node:crypto');
  const sqlite = await getDbInstance();
  const now = new Date().toISOString();
  sqlite.prepare(`UPDATE jobs SET delivery_status = ?, updated_at = ? WHERE id = ?`).run(deliveryStatus, now, id);
  sqlite.prepare("INSERT INTO print_events (id, job_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(crypto.randomUUID(), id, deliveryStatus, `Delivery status set to ${deliveryStatus}.`, now);
}
```

- [ ] **Step 8: Add `updateDeliveryStatus` — Supabase implementation**

In `src/lib/db-supabase.ts`, add directly after `updateJobStatus` (after line 328):

```typescript
export async function updateDeliveryStatus(id: string, deliveryStatus: 'out_for_delivery' | 'delivered'): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('jobs')
    .update({ delivery_status: deliveryStatus, updated_at: now })
    .eq('id', id);
  if (error) throw error;

  await supabase
    .from('print_events')
    .insert([{ id: crypto.randomUUID(), job_id: id, event_type: deliveryStatus, message: `Delivery status set to ${deliveryStatus}.`, created_at: now }]);
}
```

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors (this catches any missing field on `Job`/`PricingConfig` object literals across the codebase).

- [ ] **Step 10: Commit**

```bash
git add src/lib/db.ts src/lib/db-supabase.ts
git commit -m "feat: wire delivery fields through db layer, add updateDeliveryStatus"
```

---

## Task 3: `POST /api/jobs` — accept delivery fields, price them, validate

**Files:**
- Modify: `src/app/api/jobs/route.ts:22-180` (single-file `POST` handler only — bulk handler untouched, per Global Constraints)
- Test: manual (documented in Step 4 below) — this route has no existing test file, so this follows the codebase's existing convention of route-level manual verification rather than introducing a new test harness for one route.

**Interfaces:**
- Consumes: `createJob(jobData, fileData)` from Task 2 (accepts `deliveryMethod`/`customerName`/`customerPhone`/`deliveryAddress`/`deliveryFeePaise` on `jobData`), `getPricing()` (now returns `deliveryFeePaise`).
- Produces: `POST /api/jobs` response now also includes `deliveryFeePaise: number` in its JSON body, used by `UploadForm.tsx` in Task 5 to render the price breakdown after submit.

- [ ] **Step 1: Parse and validate delivery fields**

In `src/app/api/jobs/route.ts`, in the single-file `POST` handler, add right after the existing settings-validation block (after line 65, `if (!printTypes.includes(printType) || ... ) { return ... }`):

```typescript
    const deliveryMethod = String(form.get("deliveryMethod") ?? "pickup") as "pickup" | "delivery";
    if (deliveryMethod !== "pickup" && deliveryMethod !== "delivery") {
      return NextResponse.json({ error: "Invalid delivery method" }, { status: 400 });
    }
    let customerName: string | null = null;
    let customerPhone: string | null = null;
    let deliveryAddress: string | null = null;
    if (deliveryMethod === "delivery") {
      customerName = String(form.get("customerName") ?? "").trim();
      customerPhone = String(form.get("customerPhone") ?? "").trim();
      deliveryAddress = String(form.get("deliveryAddress") ?? "").trim();
      if (!customerName) {
        return NextResponse.json({ error: "Name is required for home delivery" }, { status: 400 });
      }
      if (!/^\d{10}$/.test(customerPhone)) {
        return NextResponse.json({ error: "Enter a valid 10-digit phone number" }, { status: 400 });
      }
      if (!deliveryAddress) {
        return NextResponse.json({ error: "Address is required for home delivery" }, { status: 400 });
      }
    }
```

- [ ] **Step 2: Add the delivery fee on top of the print price**

Replace the price calculation line (currently line 142):

```typescript
    const pricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount: Math.max(pageCount, 1), pricing, duplex });
```

with:

```typescript
    const printPricePaise = calculatePrice({ printType, copies, pageRange, paperSize, pageCount: Math.max(pageCount, 1), pricing, duplex });
    const deliveryFeePaise = deliveryMethod === "delivery" ? pricing.deliveryFeePaise : 0;
    const pricePaise = printPricePaise + deliveryFeePaise;
```

- [ ] **Step 3: Pass the new fields into `jobData` and the response**

In the `jobData` object (currently lines 146-161), add after `queue_position: queuePos`:

```typescript
      delivery_method: deliveryMethod,
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_address: deliveryAddress,
      delivery_fee_paise: deliveryFeePaise
```

Update the final response (currently line 176):

```typescript
    return NextResponse.json({ jobId, token, pricePaise, deliveryFeePaise, needsConversion: Boolean(needsConversion), pageCount, queuePosition: queuePos });
```

- [ ] **Step 4: Manually verify pickup is unaffected and delivery is priced correctly**

Run: `npm run dev`, then in another shell:

```bash
curl -s -X POST http://localhost:3000/api/jobs \
  -F "printType=bw" -F "copies=1" -F "paperSize=A4" -F "layout=portrait" \
  -F "scale=default" -F "margins=default" -F "pagesPerSheet=1" -F "duplex=simplex" \
  -F "isDirectUpload=false" -F "file=@package.json;type=application/pdf"
```
Expected: `deliveryFeePaise` is `0` in the response, `pricePaise` matches the pre-existing pickup price (no regression).

```bash
curl -s -X POST http://localhost:3000/api/jobs \
  -F "printType=bw" -F "copies=1" -F "paperSize=A4" -F "layout=portrait" \
  -F "scale=default" -F "margins=default" -F "pagesPerSheet=1" -F "duplex=simplex" \
  -F "isDirectUpload=false" -F "file=@package.json;type=application/pdf" \
  -F "deliveryMethod=delivery" -F "customerName=Test User" -F "customerPhone=9876543210" -F "deliveryAddress=123 Test Street"
```
Expected: `deliveryFeePaise` equals whatever `pricing_config.delivery_fee_paise` currently is (0 until Task 4's admin UI sets it), and `pricePaise` = print cost + that fee.

Also verify rejection: omit `customerPhone` with `deliveryMethod=delivery` → expect `400` with `"Enter a valid 10-digit phone number"`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/route.ts
git commit -m "feat: accept and price delivery orders in job creation"
```

---

## Task 4: Admin pricing — `deliveryFeePaise` field (API + UI)

**Files:**
- Modify: `src/app/api/admin/pricing/route.ts:16-41`
- Modify: `src/components/AdminDashboard.tsx:32-73` (`Pricing` type, `defaultPricing`), `:370-420` (pricing form state/handlers), `:490-520` (pricing form JSX — inserted near the existing `duplexBwPerPagePaise` field)

**Interfaces:**
- Consumes: `getPricing`/`updatePricing` from Task 2 (now round-trip `deliveryFeePaise`).
- Produces: admin can set a flat delivery fee (in ₹, stored as paise) that Task 3's job pricing reads.

- [ ] **Step 1: Require and pass through `deliveryFeePaise` in the pricing API route**

In `src/app/api/admin/pricing/route.ts`, add `"deliveryFeePaise"` to the `required` array (line 16-20) and `deliveryFeePaise: body.deliveryFeePaise` to the `updatePricing({ ... })` call (lines 27-41).

- [ ] **Step 2: Add the field to the admin `Pricing` type and default**

In `src/components/AdminDashboard.tsx`, add `deliveryFeePaise: number;` to the `Pricing` type (after line 45, `expiryMinutes: number;`) and `deliveryFeePaise: 0,` to `defaultPricing` (after line 72).

- [ ] **Step 3: Read the surrounding pricing-form state pattern before adding the field**

Read `src/components/AdminDashboard.tsx:370-420` (the `priceInputs`/`formData`/`updatePriceField`/`updateField` block) to confirm the exact local variable names in this session's copy of the file — the codebase changes fast, so re-check line numbers match this plan's line 380/393/408 references before editing (per this project's convention of verifying line anchors, not assuming they're static across sessions).

- [ ] **Step 4: Add `deliveryFeePaise` to the pricing form input state**

Mirror the existing `duplexBwPerPagePaise` handling exactly: add it to the `priceInputs` initializer (alongside line 380), the `nextPricing` sync (alongside line 393), and the `updatePriceField` field union (line 408) — extend the union type to `"bwPerPagePaise" | "colorPerPagePaise" | "photoPrintPaise" | "duplexBwPerPagePaise" | "deliveryFeePaise"`.

- [ ] **Step 5: Add the delivery fee input to the pricing form JSX**

Insert a new `<div className="pricing-field">` block right after the existing duplex pricing field (after line 517, mirroring the block at lines 498-517 that renders `duplexBwPerPagePaise`):

```tsx
              <div className="pricing-field">
                <label>Delivery Fee (flat, ₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceInputs.deliveryFeePaise}
                  onChange={(e) => updatePriceField("deliveryFeePaise", e.target.value)}
                />
                <span className="pricing-hint">Added once per home-delivery order, on top of the print cost.</span>
              </div>
```

- [ ] **Step 6: Manually verify**

Run: `npm run dev`, log into `/admin`, open pricing settings, set "Delivery Fee" to e.g. `4000` (₹40.00), save. Reload the page — confirm the value persists. Re-run Task 3 Step 4's delivery `curl` command — confirm `deliveryFeePaise` in the response now equals the saved fee.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/pricing/route.ts src/components/AdminDashboard.tsx
git commit -m "feat: add flat delivery fee to admin pricing config"
```

---

## Task 5: Customer upload form — pickup/delivery toggle, contact fields, forced online payment

**Files:**
- Modify: `src/components/UploadForm.tsx`
  - `Pricing` type (lines 9-26): add `deliveryFeePaise: number;`
  - New state near line 63-74: `deliveryMethod`, `customerName`, `customerPhone`, `deliveryAddress`
  - `estimate` (lines 373-410): add delivery fee
  - Settings step (insert after line 1415, before "Add more PDFs" block): pickup/delivery toggle + contact fields
  - Preview step (lines 1852-1856): price breakdown
  - `handleSubmit` (lines 793-803): append new form fields
  - `resetForm` (lines 865-879): reset new state
  - Payment/done section (lines 965-1213): force Razorpay-only path when `deliveryMethod === "delivery"`, skip the "Pay at counter"/cash choice entirely

**Interfaces:**
- Consumes: `POST /api/jobs` (Task 3) now accepts `deliveryMethod`/`customerName`/`customerPhone`/`deliveryAddress` and returns `deliveryFeePaise`; `pricing.deliveryFeePaise` from `GET /api/pricing`.
- Produces: nothing new consumed by later tasks — this is the terminal customer-facing task.

- [ ] **Step 1: Add `deliveryFeePaise` to the local `Pricing` type**

In `src/components/UploadForm.tsx`, add `deliveryFeePaise: number;` to the `Pricing` type after line 21 (`duplexBwPerPagePaise: number;`).

- [ ] **Step 2: Add delivery state**

After line 73 (`const [payMethod, setPayMethod] = useState<"online" | "offline" | null>(null);`), add:

```typescript
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "delivery">("pickup");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
```

- [ ] **Step 3: Include the delivery fee in the live price estimate**

In the `estimate` `useMemo` (lines 373-410), change the final `return` (line 409) from:

```typescript
    return Math.round(pageCostSum * copies * paperMultiplier * pricing.copyMultiplier) / 100;
  }, [copies, selectedPages, paperSize, printType, pricing, duplex, isBulk, bulkTotalPages]);
```

to:

```typescript
    const printCost = Math.round(pageCostSum * copies * paperMultiplier * pricing.copyMultiplier) / 100;
    const deliveryFee = deliveryMethod === "delivery" ? pricing.deliveryFeePaise / 100 : 0;
    return printCost + deliveryFee;
  }, [copies, selectedPages, paperSize, printType, pricing, duplex, isBulk, bulkTotalPages, deliveryMethod]);
```

Note: the `paperSize === "Photo"` early return (lines 378-382) also needs the delivery fee added — change it from:
```typescript
      return Math.round(pricing.photoPrintPaise * copies) / 100;
```
to:
```typescript
      return Math.round(pricing.photoPrintPaise * copies) / 100 + (deliveryMethod === "delivery" ? pricing.deliveryFeePaise / 100 : 0);
```

- [ ] **Step 4: Add the pickup/delivery toggle + contact fields to the settings step**

Insert this block in the `step === "settings"` section, right after the file-summary buttons close (after line 1415, before the `{/* Add more PDFs to this job ... */}` comment at line 1417). Bulk mode keeps pickup-only (per Global Constraints), so the toggle is hidden when `isBulk`:

```tsx
          {!isBulk && (
            <div className="delivery-method-section">
              <h4 className="delivery-method-title">How will you get your prints?</h4>
              <div className="delivery-method-toggle" role="group" aria-label="Pickup or delivery">
                <button
                  type="button"
                  className={`delivery-method-btn ${deliveryMethod === "pickup" ? "active" : ""}`}
                  onClick={() => setDeliveryMethod("pickup")}
                  aria-pressed={deliveryMethod === "pickup"}
                >
                  <Store size={18} aria-hidden="true" />
                  Shop Pickup
                </button>
                <button
                  type="button"
                  className={`delivery-method-btn ${deliveryMethod === "delivery" ? "active" : ""}`}
                  onClick={() => setDeliveryMethod("delivery")}
                  aria-pressed={deliveryMethod === "delivery"}
                >
                  <UploadCloud size={18} aria-hidden="true" />
                  Home Delivery
                  {pricing && pricing.deliveryFeePaise > 0 && (
                    <span className="delivery-fee-tag">+{formatRupees(pricing.deliveryFeePaise)}</span>
                  )}
                </button>
              </div>

              {deliveryMethod === "delivery" && (
                <div className="delivery-contact-fields">
                  <input
                    type="text"
                    placeholder="Full name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="delivery-input"
                  />
                  <input
                    type="tel"
                    placeholder="10-digit phone number"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className="delivery-input"
                  />
                  <textarea
                    placeholder="Full delivery address"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                    className="delivery-input delivery-address-input"
                    rows={2}
                  />
                </div>
              )}
            </div>
          )}
```

`Store` and `UploadCloud` are already imported (used elsewhere in this file — see the `lucide-react` import at line 4), so no import changes are needed.

- [ ] **Step 5: Add delivery validation before advancing past settings**

Find `goToPreview` (lines 857-863) and add a delivery-field check before `setStep("preview")`:

```typescript
  function goToPreview() {
    if (isDuplexInvalid) {
      setError("Double-sided printing requires at least 2 pages.");
      return;
    }
    if (deliveryMethod === "delivery" && (!customerName.trim() || !/^\d{10}$/.test(customerPhone) || !deliveryAddress.trim())) {
      setError("Enter your name, a 10-digit phone number, and delivery address.");
      return;
    }
    setStep("preview");
  }
```

- [ ] **Step 6: Show the price breakdown on the preview step**

Replace the "Total price" block (lines 1852-1856):

```tsx
          {/* Total price */}
          <div className="total-price">
            <span>Total</span>
            <strong>{pricing ? `₹${estimate.toFixed(2)}` : "…"}</strong>
          </div>
```

with:

```tsx
          {/* Total price */}
          {deliveryMethod === "delivery" && pricing ? (
            <div className="total-price-breakdown">
              <div className="total-price-row">
                <span>Printing</span>
                <span>₹{(estimate - pricing.deliveryFeePaise / 100).toFixed(2)}</span>
              </div>
              <div className="total-price-row">
                <span>Delivery</span>
                <span>₹{(pricing.deliveryFeePaise / 100).toFixed(2)}</span>
              </div>
              <div className="total-price">
                <span>Total</span>
                <strong>₹{estimate.toFixed(2)}</strong>
              </div>
            </div>
          ) : (
            <div className="total-price">
              <span>Total</span>
              <strong>{pricing ? `₹${estimate.toFixed(2)}` : "…"}</strong>
            </div>
          )}
```

- [ ] **Step 7: Send the delivery fields to `/api/jobs`**

In `handleSubmit` (lines 780-855), add after `form.set("duplex", duplex);` (line 802):

```typescript
    form.set("deliveryMethod", deliveryMethod);
    if (deliveryMethod === "delivery") {
      form.set("customerName", customerName.trim());
      form.set("customerPhone", customerPhone);
      form.set("deliveryAddress", deliveryAddress.trim());
    }
```

- [ ] **Step 8: Reset delivery state on form reset**

In `resetForm` (lines 865-879), add:

```typescript
    setDeliveryMethod("pickup");
    setCustomerName("");
    setCustomerPhone("");
    setDeliveryAddress("");
```

- [ ] **Step 9: Force the Razorpay-only payment path for delivery orders**

In the result/done screen logic (around lines 965-968), change:

```typescript
    const razorpayKeyId = (pricing?.razorpayKeyId ?? "").trim();
    const showRazorpay = Boolean(razorpayKeyId) && !result.needsConversion && result.pricePaise >= 100;
    // Online payment (UPI QR or Razorpay) is offered as a choice alongside cash.
    const onlineAvailable = !result.needsConversion && (Boolean(upiLink) || showRazorpay);
```

to:

```typescript
    const razorpayKeyId = (pricing?.razorpayKeyId ?? "").trim();
    const showRazorpay = Boolean(razorpayKeyId) && !result.needsConversion && result.pricePaise >= 100;
    // Online payment (UPI QR or Razorpay) is offered as a choice alongside cash
    // for pickup orders. Delivery orders skip the counter entirely, so they
    // must pay online — no cash choice, no counter fallback.
    const isDeliveryOrder = deliveryMethod === "delivery";
    const onlineAvailable = !result.needsConversion && (Boolean(upiLink) || showRazorpay);
```

Then, in the JSX (around lines 1090-1213), the existing structure is:
```tsx
        ) : onlineAvailable ? (
          <>
            {/* Payment method chooser */}
            <div className="pay-choice" ...>
```

Change the payment-method chooser to skip straight to the Razorpay block for delivery orders — wrap the existing "Payment method chooser" `<div className="pay-choice">` block (lines 1093-1114) and the `payMethod === null` hint (lines 1116-1118) in a condition:

```tsx
            {!isDeliveryOrder && (
              <div className="pay-choice" role="group" aria-label="Choose how to pay">
                {/* ...existing pay-choice-btn buttons unchanged... */}
              </div>
            )}

            {!isDeliveryOrder && payMethod === null && (
              <p className="pay-hint">Select a payment method above</p>
            )}
```

And change the render condition that currently gates the Razorpay block on `payMethod === "online"` (line 1120, `{payMethod === "online" && (`) to also fire automatically for delivery orders:

```tsx
            {(payMethod === "online" || isDeliveryOrder) && (
```

Delivery orders never see the `payMethod === "offline"` branch because `isDeliveryOrder` short-circuits the chooser that would ever set `payMethod` to `"offline"` — no separate guard needed there since that branch is simply never reached when the chooser div isn't rendered and `payMethod` stays `null`.

- [ ] **Step 10: Manual verification — full delivery flow in the browser**

Run: `npm run dev`, open `http://localhost:3000`.
1. Upload a small PDF, on the settings step select "Home Delivery", fill name/phone/address, confirm the delivery fee tag shows on the button.
2. Advance to preview — confirm the price breakdown shows Printing + Delivery = Total matching Task 3/4's verified math.
3. Try to advance with an invalid phone (e.g. `123`) — confirm the inline error blocks navigation.
4. Confirm print job — on the token screen, confirm **no** "Pay Cash / At counter" option appears, and the Razorpay button renders directly (if `RAZORPAY_KEY_ID` isn't set yet in this environment, `showRazorpay` will be `false` and nothing renders here — that's expected per Global Constraints; full payment verification happens once real keys are set, which is a manual ops step, not part of this plan).
5. Repeat with "Shop Pickup" selected — confirm the flow is pixel-identical to before this change (no delivery fields, cash/counter choice still present).

- [ ] **Step 11: Commit**

```bash
git add src/components/UploadForm.tsx
git commit -m "feat: add pickup/delivery toggle and forced online payment to upload form"
```

---

## Task 6: New endpoint — `POST /api/admin/jobs/[id]/delivery-status`

**Files:**
- Create: `src/app/api/admin/jobs/[id]/delivery-status/route.ts`

**Interfaces:**
- Consumes: `getJobById`, `updateDeliveryStatus`, `sseClients` from `src/lib/db` (Task 2); `requireAdminResponse` from `src/lib/security`.
- Produces: `POST /api/admin/jobs/[id]/delivery-status` with body `{ deliveryStatus: "out_for_delivery" | "delivered" }` → `{ ok: true, job: Job }`. Consumed by Task 7/8 (`AdminDashboard.tsx`, `JobDetail.tsx`).

- [ ] **Step 1: Write the route, mirroring the existing `status/route.ts` pattern**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getJobById, updateDeliveryStatus, sseClients } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

const allowed = ["out_for_delivery", "delivered"] as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { deliveryStatus } = await request.json();
  if (!allowed.includes(deliveryStatus)) {
    return NextResponse.json({ error: "Unsupported delivery status" }, { status: 400 });
  }
  const { id } = await params;

  let job;
  try {
    job = await getJobById(id);
  } catch {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.deliveryMethod !== "delivery") {
    return NextResponse.json({ error: "This job is not a delivery order" }, { status: 400 });
  }
  const invalid = invalidTransition(job.deliveryStatus, job.status, deliveryStatus);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  await updateDeliveryStatus(id, deliveryStatus);

  const updated = await getJobById(id);
  broadcast({ type: "job_update", jobId: id, status: updated.status, deliveryStatus: updated.deliveryStatus, paidAt: updated.paidAt, token: job.token });

  return NextResponse.json({ ok: true, job: updated });
}

function invalidTransition(current: string | null, printStatus: string, next: string) {
  if (next === "out_for_delivery") {
    if (printStatus !== "printed") return "Job must be printed before it can go out for delivery.";
    if (current === "delivered") return "This job was already delivered.";
    return "";
  }
  // next === "delivered"
  if (current !== "out_for_delivery") return "Mark it out for delivery first.";
  return "";
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

- [ ] **Step 2: Manually verify the transition guards**

Run: `npm run dev`, log into `/admin` (session cookie needed — easiest via browser devtools `fetch` on the `/admin` page so `credentials: "include"` picks up the session), then:

```javascript
// From the browser console while logged into /admin, using a real delivery job id:
await fetch(`/api/admin/jobs/<id>/delivery-status`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deliveryStatus: "out_for_delivery" }) }).then(r => r.json())
```

Expected: `400` with `"Job must be printed before it can go out for delivery."` if the job isn't `printed` yet; `{ ok: true, job }` with `job.deliveryStatus === "out_for_delivery"` once it is; then `delivered` succeeds only after that.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/admin/jobs/[id]/delivery-status/route.ts
git commit -m "feat: add delivery-status transition endpoint"
```

---

## Task 7: Admin dashboard — Pickup/Delivery filter + delivery info & actions on job cards

**Files:**
- Modify: `src/components/AdminDashboard.tsx`
  - `Job` type (lines 13-30): add delivery fields
  - New state near the existing `filterStatus` state: `deliveryFilter`
  - `filteredJobs` computation (lines 1650-1660): apply the delivery filter on top of the status filter
  - `jobAction`/`doAction` dispatch (lines 1551-1601): route `out_for_delivery`/`delivered` actions to the new endpoint
  - `JobCard` (lines 1073-1250ish): show customer name/phone/address for delivery jobs + the two new action buttons

**Interfaces:**
- Consumes: `POST /api/admin/jobs/[id]/delivery-status` (Task 6); `Job.deliveryMethod`/`deliveryStatus`/`customerName`/`customerPhone`/`deliveryAddress` (flow through `GET /api/admin/jobs` automatically once the type is updated, per Task 1/2 — no route change needed there, confirmed by reading `src/app/api/admin/jobs/route.ts`, which just spreads whatever `getJobsPage` returns).

- [ ] **Step 1: Extend the local `Job` type**

In `src/components/AdminDashboard.tsx`, add to the `Job` type (after line 29, `fileCount?: number;`):

```typescript
  deliveryMethod?: "pickup" | "delivery";
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryStatus?: "pending" | "out_for_delivery" | "delivered" | null;
```

- [ ] **Step 2: Add a delivery-method filter state and apply it**

Find the `filterStatus` state declaration (used at `filteredJobs = filterStatus === "all" ? jobs : ...`, around line 1652) and add a sibling state right next to it:

```typescript
  const [deliveryFilter, setDeliveryFilter] = useState<"all" | "pickup" | "delivery">("all");
```

Change the `filteredJobs` computation (lines 1650-1658) from:

```typescript
  const filteredJobs = filterStatus === "all"
    ? jobs
    : filterStatus === "unpaid"
      ? jobs.filter((j) => !j.paidAt && j.status !== "cancelled")
      : filterStatus === "pending_payment"
        ? jobs.filter((j) => j.status === "pending_payment" || j.status === "paid")
        : jobs.filter((j) => j.status === filterStatus);
```

to:

```typescript
  const methodFilteredJobs = deliveryFilter === "all"
    ? jobs
    : jobs.filter((j) => (j.deliveryMethod ?? "pickup") === deliveryFilter);
  const filteredJobs = filterStatus === "all"
    ? methodFilteredJobs
    : filterStatus === "unpaid"
      ? methodFilteredJobs.filter((j) => !j.paidAt && j.status !== "cancelled")
      : filterStatus === "pending_payment"
        ? methodFilteredJobs.filter((j) => j.status === "pending_payment" || j.status === "paid")
        : methodFilteredJobs.filter((j) => j.status === filterStatus);
```

- [ ] **Step 3: Render the Pickup/Delivery toggle above the existing status `FilterTabs`**

Find where `<FilterTabs` is rendered (line 1776) and insert directly before it:

```tsx
          <div className="delivery-filter-toggle" role="group" aria-label="Filter by fulfillment method">
            {(["all", "pickup", "delivery"] as const).map((f) => (
              <button
                type="button"
                key={f}
                className={`delivery-filter-btn ${deliveryFilter === f ? "active" : ""}`}
                onClick={() => setDeliveryFilter(f)}
                aria-pressed={deliveryFilter === f}
              >
                {f === "all" ? "All Orders" : f === "pickup" ? "Pickup" : "Delivery"}
              </button>
            ))}
          </div>
```

- [ ] **Step 4: Route delivery-status actions to the new endpoint**

In `jobAction` (lines 1551-1601), change the `endpoint` selection (lines 1555-1561) from:

```typescript
      const endpoint = action === "convert"
        ? `/api/admin/jobs/${jobId}/convert`
        : action === "reprint"
          ? `/api/admin/jobs/${jobId}/reprint`
          : action === "resolve_issue"
            ? `/api/admin/jobs/${jobId}/resolve-issue`
            : `/api/admin/jobs/${jobId}/status`;
      const noBodyActions = ["reprint", "convert", "resolve_issue"];
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: noBodyActions.includes(action) ? undefined : JSON.stringify({ status: action })
      });
```

to:

```typescript
      const isDeliveryAction = action === "out_for_delivery" || action === "delivered";
      const endpoint = action === "convert"
        ? `/api/admin/jobs/${jobId}/convert`
        : action === "reprint"
          ? `/api/admin/jobs/${jobId}/reprint`
          : action === "resolve_issue"
            ? `/api/admin/jobs/${jobId}/resolve-issue`
            : isDeliveryAction
              ? `/api/admin/jobs/${jobId}/delivery-status`
              : `/api/admin/jobs/${jobId}/status`;
      const noBodyActions = ["reprint", "convert", "resolve_issue"];
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: noBodyActions.includes(action)
          ? undefined
          : JSON.stringify(isDeliveryAction ? { deliveryStatus: action } : { status: action })
      });
```

Also add to the `toastMsg` map (lines 1582-1590):
```typescript
        out_for_delivery: "Marked out for delivery",
        delivered: "Marked delivered",
```

- [ ] **Step 5: Show delivery contact info and action buttons on delivery job cards**

In `JobCard` (starting line 1073), add a contact-info block right after the "Customer-reported issue" block (after line 1198, before the closing `</div>` of `.job-content` at line 1199):

```tsx
        {job.deliveryMethod === "delivery" && (
          <div className="job-delivery-info">
            <span className="job-delivery-tag">Delivery</span>
            <span>{job.customerName} · {job.customerPhone}</span>
            <span className="job-delivery-address">{job.deliveryAddress}</span>
          </div>
        )}
```

Then add the two delivery action buttons in `.job-actions`, right after the existing "Done" button block (after line 1234, the closing `)}` of the `(job.status === "approved" || ...)` "Done" button):

```tsx
        {job.deliveryMethod === "delivery" && job.status === "printed" && job.deliveryStatus !== "out_for_delivery" && job.deliveryStatus !== "delivered" && (
          <button type="button" className="job-btn release" onClick={() => handleActionClick("out_for_delivery")} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <Printer size={14} />}
            <span>Out for Delivery</span>
          </button>
        )}
        {job.deliveryMethod === "delivery" && job.deliveryStatus === "out_for_delivery" && (
          <button type="button" className="job-btn done" onClick={() => handleActionClick("delivered")} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            <span>Delivered</span>
          </button>
        )}
```

(`actionLoading` here refers to the per-card boolean already computed from the parent's `actionLoading === job.id` check used by the neighboring buttons in this component — reuse whatever the existing "Done" button uses for its `disabled` prop rather than introducing a new variable.)

- [ ] **Step 6: Manually verify**

Run: `npm run dev`, log into `/admin`. Create one pickup and one delivery test order (via the customer UI from Task 5). Confirm:
- The "All Orders / Pickup / Delivery" toggle filters the list correctly.
- The delivery order's card shows name/phone/address and does **not** show these on the pickup order's card.
- "Out for Delivery" only appears once the delivery order reaches `printed`, and "Delivered" only appears after that.

- [ ] **Step 7: Commit**

```bash
git add src/components/AdminDashboard.tsx
git commit -m "feat: add pickup/delivery filter and delivery actions to admin dashboard"
```

---

## Task 8: Job detail page — delivery contact card + actions

**Files:**
- Modify: `src/components/JobDetail.tsx`
  - `Detail["job"]` type (lines 13-32): add delivery fields
  - New `DeliveryCard` component
  - `ActionsCard` (lines 329-409): add the two delivery action buttons
  - Main render (lines 227-232): render `DeliveryCard` when applicable

**Interfaces:**
- Consumes: `GET /api/admin/jobs/[id]` (already returns the full `Job` object, including new delivery fields, once Task 1/2 land — no server change needed here, confirmed by reading `src/app/api/admin/jobs/[id]/route.ts`).
- Produces: nothing consumed by later tasks — terminal admin-facing task.

- [ ] **Step 1: Extend the `Detail["job"]` type**

In `src/components/JobDetail.tsx`, add to the `job` object inside `Detail` (after line 31, `paidAt: string | null;`):

```typescript
    deliveryMethod?: "pickup" | "delivery";
    customerName?: string | null;
    customerPhone?: string | null;
    deliveryAddress?: string | null;
    deliveryStatus?: "pending" | "out_for_delivery" | "delivered" | null;
```

- [ ] **Step 2: Add a `setDeliveryStatus` handler alongside `setStatus`**

After `setStatus` (lines 93-107), add:

```typescript
  async function setDeliveryStatus(deliveryStatus: string) {
    setError("");
    const response = await fetch(`/api/admin/jobs/${id}/delivery-status`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryStatus })
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Action failed");
      return;
    }
    await load();
  }
```

- [ ] **Step 3: Add a `DeliveryCard` component**

Add this new component after `SummaryCard` (after line 327):

```tsx
function DeliveryCard({ job }: { job: Detail["job"] }) {
  if (job.deliveryMethod !== "delivery") return null;
  return (
    <div className="detail-card">
      <h3 className="card-title">Delivery Details</h3>
      <div className="summary-list">
        <div className="summary-row"><span>Name</span><strong>{job.customerName}</strong></div>
        <div className="summary-row"><span>Phone</span><strong>{job.customerPhone}</strong></div>
        <div className="summary-row"><span>Address</span><strong>{job.deliveryAddress}</strong></div>
        <div className="summary-row"><span>Status</span><strong>{deliveryStatusLabel(job.deliveryStatus)}</strong></div>
      </div>
    </div>
  );
}

function deliveryStatusLabel(status?: string | null) {
  if (status === "out_for_delivery") return "Out for Delivery";
  if (status === "delivered") return "Delivered";
  return "Pending";
}
```

- [ ] **Step 4: Render `DeliveryCard` in the details pane**

In the main render (lines 228-232), change:

```tsx
        <section className={`detail-pane detail-pane-details ${activeTab === "details" ? "active" : ""}`}>
          <FileCard files={files} />
          <SummaryCard job={job} files={files} />
          <ActionsCard job={job} setStatus={setStatus} reprint={reprint} />
        </section>
```

to:

```tsx
        <section className={`detail-pane detail-pane-details ${activeTab === "details" ? "active" : ""}`}>
          <FileCard files={files} />
          <SummaryCard job={job} files={files} />
          <DeliveryCard job={job} />
          <ActionsCard job={job} setStatus={setStatus} setDeliveryStatus={setDeliveryStatus} reprint={reprint} />
        </section>
```

- [ ] **Step 5: Add delivery buttons to `ActionsCard`**

Update the `ActionsCard` signature (lines 329-337) to accept `setDeliveryStatus`:

```typescript
function ActionsCard({
  job,
  setStatus,
  setDeliveryStatus,
  reprint
}: {
  job: Detail["job"];
  setStatus: (status: string) => void;
  setDeliveryStatus: (status: string) => void;
  reprint: () => void;
}) {
```

Add these buttons inside `.detail-action-grid`, right after the existing "Mark Done" button block (after line 384, the closing `)}` of the `(job.status === "approved" || ...)` block):

```tsx
        {job.deliveryMethod === "delivery" && job.status === "printed" && job.deliveryStatus !== "out_for_delivery" && job.deliveryStatus !== "delivered" && (
          <button type="button" className="job-btn release" onClick={() => setDeliveryStatus("out_for_delivery")}>
            <Printer size={16} /> Out for Delivery
          </button>
        )}
        {job.deliveryMethod === "delivery" && job.deliveryStatus === "out_for_delivery" && (
          <button type="button" className="job-btn done" onClick={() => setDeliveryStatus("delivered")}>
            <CheckCircle2 size={16} /> Delivered
          </button>
        )}
```

- [ ] **Step 6: Typecheck and manually verify**

Run: `npm run typecheck` — expect no errors.

Run: `npm run dev`, open a delivery job's detail page at `/admin/jobs/[id]`. Confirm the Delivery Details card shows name/phone/address/status, and the action buttons appear/disappear at the same points verified in Task 7 Step 6.

- [ ] **Step 7: Commit**

```bash
git add src/components/JobDetail.tsx
git commit -m "feat: add delivery details card and actions to job detail page"
```

---

## Task 9: End-to-end verification and production payment activation note

**Files:** none (verification-only task; one `.env`-adjacent operational note, no code change)

- [ ] **Step 1: Run the full typecheck and test suite**

Run: `npm run typecheck && npm run test`
Expected: both pass with no errors (Task 2's Step 9 typecheck already covers the db layer; this is the final full-repo pass after all UI/route changes).

- [ ] **Step 2: Full regression pass on the pickup flow**

Run: `npm run dev`. Walk the entire existing pickup flow once (upload → settings, leave "Shop Pickup" selected → preview → confirm → token screen → pay cash/counter choice) and confirm it behaves identically to before this plan — no delivery fields visible, no extra required input, price unchanged for a pickup order with the same settings used before this change.

- [ ] **Step 3: Full walkthrough of the delivery flow**

Repeat Task 5 Step 10's walkthrough end to end, then in `/admin`: release the job (Task 7's "Release" button — unaffected, still gates on `paidAt` exactly like pickup), mark it printed, mark it "Out for Delivery", mark it "Delivered". Confirm each admin action shows the correct toast message and the job disappears from the "Delivery" filter's actionable view once `delivered` (still visible under "All Orders", same as a collected pickup job).

- [ ] **Step 4: Note the one manual, non-code step required for delivery payments to actually work in production**

This plan wires the *code* path for online payment, but `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` are currently commented out / unset in `.env` (see the "BACKUP: Razorpay UPI-only (auto-confirm)" block). `isRazorpayConfigured()` (`src/lib/razorpay.ts:12-14`) gates the entire checkout UI on these being present, so until real (not test) keys are set in both `.env` and the Vercel project's environment variables and the app is redeployed, `showRazorpay` will be `false` and the delivery payment button will not render — meaning delivery orders can be created but customers cannot pay for them yet. This is an operational/secrets task, not a code task, and is intentionally left out of this plan's scope; flag it to the user before considering delivery "live."

- [ ] **Step 5: Final commit (if any cleanup was needed during verification)**

If Steps 1-3 required any fixes, commit them individually with descriptive messages as usual. If verification passed with no changes needed, there is nothing to commit here — this step exists only to catch stragglers, not to force an empty commit.
