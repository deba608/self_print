# Customer Order Tracking — Design

Date: 2026-07-20. Approved by user.

## Goal
Let a customer check their order's status after leaving the token screen — from any device, using only their 6-digit token.

## Design

### API
Extend `GET /api/jobs/[token]/status` to also return `queuePosition`, `pricePaise`, `createdAt`, `fileCount`. Token-gated; no file names or contents exposed.

### `/track` page
`src/app/track/page.tsx` (server shell, reads `?token=` via searchParams) + `src/components/TrackOrder.tsx` (client):
- 6-digit OTP-style input, auto-submits when full; pre-fills from `?token=`.
- 4-step vertical status timeline: Submitted → Paid → Printing → Ready.
  - Status map: `pending_payment` → step 2 pulsing "Pay at counter"; `paid` → step 2 done; `approved`/`printing` → step 3 active (animated printer); `printed` → all done (check draw); `failed`/`cancelled` → error card.
- Poll every 5s while a job is loaded; step change animates.
- Unknown token → "not found or expired" state.
- Saves last-checked token to `localStorage("selfprint:lastToken")`.

### Entry points
- Home upload step: "Check order status" link; if localStorage token exists, chip "Recent order #XXXXXX → Track".
- Result/token screen: "Track this order" button linking `/track?token=…`; token saved to localStorage on submit success.

## Non-goals
Push/SMS notifications, multi-order history, order cancellation by customer.

## Testing
Typecheck + build; live preview walk: enter known token, verify timeline, verify 404 state.
