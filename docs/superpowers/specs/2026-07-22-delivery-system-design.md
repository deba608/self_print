# Delivery System Addition — Design

Date: 2026-07-22

## Purpose

Customers can currently only pick up printed jobs at the shop counter. This adds a second fulfillment path: home delivery, handled by the shop's own delivery staff (no third-party courier). Customer chooses pickup or delivery at upload time, since delivery carries an extra flat fee that must be shown before payment.

## Data Model

### `jobs` table / `Job` type — new fields (all nullable, pickup orders keep them null)

- `deliveryMethod`: `"pickup" | "delivery"` — default `"pickup"`
- `customerName`: text, required when `deliveryMethod = "delivery"`
- `customerPhone`: text, required when delivery — validated as 10-digit number
- `deliveryAddress`: text, required when delivery
- `deliveryFeePaise`: integer, snapshotted from `pricing_config` at job creation (mirrors existing `pricePaise` snapshot pattern — later fee changes don't affect existing orders)
- `deliveryStatus`: `"pending" | "out_for_delivery" | "delivered" | null` — null for pickup orders; tracked independently of `status` (which remains the print-progress field)

Pickup orders are entirely unaffected: no new required fields, same anonymous token flow, same pay-at-counter behavior.

### `pricing_config` table

- `deliveryFeePaise`: integer, flat fee, admin-editable via existing pricing config admin UI. Read once at job creation and snapshotted onto the job.

## Customer Upload Flow (`/`)

After file selection, a pickup/delivery toggle appears.

- **Pickup** (default): unchanged. No contact fields collected. Price = existing print cost calc only. Status flow unchanged: `pending_payment → approved → printing → printed`, "Pay at counter" token screen as today.
- **Delivery**: reveals required fields — name, phone (10-digit validated), address (non-empty). Price = print cost + flat `deliveryFeePaise`, shown broken out in the order summary (e.g. "Printing ₹X + Delivery ₹Y = ₹Z"). On submit, job is created with `deliveryMethod="delivery"`, `status="pending_payment"`, `deliveryStatus="pending"`.

## Payment (delivery only)

Delivery orders must be paid online upfront — no counter interaction happens for these customers.

- Re-enable the currently-commented-out Razorpay integration (`.env` has `RAZORPAY_KEY_ID`/`SECRET`/`WEBHOOK_SECRET` stubbed out; route/webhook code needs uncommenting/wiring), scoped to delivery orders only. Pickup orders keep today's "Pay at counter" screen untouched.
- Flow: after submitting a delivery order, customer is sent straight into Razorpay checkout for the full amount (print + delivery fee).
- Razorpay webhook confirms payment → sets `paidAt`, `paidVia="online"` on the job. Job now appears in the admin Delivery tab awaiting release. Unpaid delivery orders never leave the payment step (no token shown until paid).
- Production requires swapping the current Razorpay **test** keys for live keys before this goes live for real customers.

## Admin Dashboard

Job queue splits into two tabs: **Pickup** and **Delivery** (filtered by `deliveryMethod`), instead of one mixed list.

**Delivery tab** shows per job: customer name, phone, address, print settings/file preview, price breakdown, payment status (always paid by the time it appears here, since Razorpay gates entry).

Actions, in sequence:
1. **Release Print** — same manual action as pickup today (`status: pending_payment → approved`); requires `paidAt` already set (guaranteed by the Razorpay gate). Print agent picks it up and prints exactly as it does for pickup jobs — no agent-side changes.
2. Once `status = "printed"`, a **Mark Out for Delivery** button appears → sets `deliveryStatus = "out_for_delivery"`.
3. **Mark Delivered** button → sets `deliveryStatus = "delivered"` (terminal state). Job becomes eligible for the existing cleanup job (`cleanupOldJobs`), same as a collected pickup order.

No per-staff assignment — single shared delivery queue; whichever staff member is out delivering marks status themselves from the same admin dashboard (no separate delivery-person login).

## Error Handling & Edge Cases

- **Payment fails/abandoned at Razorpay**: job stays `pending_payment`, never appears in admin Delivery tab, gets swept up by existing expired-job cleanup like any unpaid job.
- **Webhook delivery failure**: Razorpay retries webhooks automatically; if payment succeeded but webhook never lands, job would incorrectly stay unpaid — mitigate by also checking payment status via Razorpay API on next admin dashboard load for orders stuck > a few minutes in `pending_payment` (same defensive pattern should exist for any future online-payment path, not delivery-specific).
- **Invalid phone/address at submit**: client + server-side validation (10-digit phone, non-empty address) before job creation — reuse existing form validation patterns from the upload form.
- **Print fails for a delivery order**: existing `status="failed"` path applies unchanged; delivery-specific buttons simply don't appear until `status="printed"`.
- **Delivery fee changes mid-flight**: no impact on already-created jobs since fee is snapshotted at creation, matching how `pricePaise` already behaves.

## Testing Plan

- Unit: pricing calc includes delivery fee correctly when `deliveryMethod="delivery"`; excluded for pickup.
- Unit: field validation (phone format, required address/name only when delivery).
- Integration: full delivery order flow — submit → Razorpay checkout (test mode) → webhook → job appears in admin Delivery tab paid → release → agent prints (existing pickup print path, unaffected) → mark out for delivery → mark delivered → cleanup eligibility.
- Regression: existing pickup flow (upload → token → pay at counter → release → print → collect) must show zero behavior change — run existing manual/automated checks for that path after this change lands.
- Manual: verify admin Pickup tab shows zero delivery-only fields/buttons, and vice versa.

## Out of Scope (this iteration)

- Third-party courier integration (Shiprocket/Dunzo/etc.) — explicitly rejected in favor of in-house delivery team.
- Distance/zone-based delivery pricing — flat fee only.
- Delivery staff assignment/tracking (which staff member is delivering which order).
- COD / pay-on-delivery — delivery orders are online-payment-only.
