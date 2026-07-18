# Bill / Receipt UI — Design

**Date:** 2026-07-18 · **Status:** Approved (user, in-chat)

## Goal
After payment confirms, the customer's token screen becomes an itemized receipt
they can screenshot or save as a PNG. Works for all three payment paths.

## Decisions (locked)
- Customer phone only (no admin print view).
- View + "Save bill as image" (PNG). No PDF, no new libraries — hand-drawn canvas.
- Live update: phone polls a public status endpoint every ~5s so staff-marked
  cash/QR payments flip the screen to the receipt automatically.
- No GST fields, no bill history, bill number = token. No DB changes.

## Components
1. **`GET /api/jobs/[token]/status`** (new, public): looks up by 6-digit token,
   returns `{ status, paidAt }` only. `Cache-Control: no-store`. 404 on unknown.
2. **`src/components/BillReceipt.tsx`** (new): receipt card + canvas PNG export.
   Props: `{ shopName, token, queuePosition, files: {name, pages}[], settings:
   {printType, duplex, paperSize, copies, pagesPerSheet}, totalPaise,
   perPagePaise, totalPages, paidVia: "online"|"counter", paidAt }`.
3. **UploadForm done screen**: new `paidInfo` state.
   - Razorpay verify success → `{ method: "online", at: now }`.
   - Poll effect (only while on done screen, unpaid): every 5s hit the status
     endpoint; status ∈ {paid, approved, printing, printed} → `{ method:
     "counter", at: paidAt }` and stop polling.
   - When `paidInfo` set → render `BillReceipt` in place of the payment UI.
   - Bill data assembled from existing client state (files/pages/settings/price).

## Receipt contents
Shop name + PAID badge · Bill/Token + date-time · per-file rows (name, pages) ·
settings line (type · sides · paper · N/sheet) · breakdown (pages × rate,
copies) · TOTAL · payment method + time · queue number + "show to staff" ·
thank-you footer. PNG drawn at 2× via `canvas.toBlob` → `bill-<token>.png`.

## Testing
Unit: none new (pure UI + trivial endpoint). Runtime: browser E2E — submit,
mark paid via admin, watch receipt appear via poll; Razorpay path smoke via
payState; PNG download produces a non-empty blob.
