# Razorpay Integration Guide

SelfPrint already has Razorpay Standard Checkout wired in. This doc: setup steps + how it works, for anyone (re)configuring it.

## Flow

1. Customer token screen calls `POST /api/payments/order` → server creates Razorpay order for job's exact price (server-trusted, not client input).
2. Browser opens Razorpay Checkout modal with `orderId` + `keyId`.
3. On success, browser posts to `POST /api/payments/verify` → HMAC signature checked → `markJobPaid()`.
4. Backup: Razorpay calls `POST /api/payments/webhook` on `payment.captured` (covers browser closed before step 3 completes) → same `markJobPaid()`, idempotent.

Files:
- [src/lib/razorpay.ts](../src/lib/razorpay.ts) — client, signature verify (payment + webhook), config check
- [src/app/api/payments/order/route.ts](../src/app/api/payments/order/route.ts) — order creation
- [src/app/api/payments/verify/route.ts](../src/app/api/payments/verify/route.ts) — client-side confirm
- [src/app/api/payments/webhook/route.ts](../src/app/api/payments/webhook/route.ts) — server-side backup confirm

## Setup

1. Razorpay Dashboard → Settings → API Keys → generate. Use `rzp_test_*` first.
2. Set env vars ([.env.example](../.env.example)):
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxx
   RAZORPAY_KEY_SECRET=xxxxx
   ```
   `isRazorpayConfigured()` gates the whole feature — both must be set or checkout falls back to UPI/pay-at-counter.
3. (Recommended) Webhook: Dashboard → Webhooks → add `<site>/api/payments/webhook`, event `payment.captured`. Copy secret into:
   ```
   RAZORPAY_WEBHOOK_SECRET=xxxxx
   ```
   Without this, only client-side verify confirms payment — misses cases where browser closes right after paying.
4. Go live: swap `rzp_test_*` → `rzp_live_*` keys after KYC. No code change needed.

## Security notes (already implemented, don't regress)

- Order amount always read from `job.pricePaise` server-side (`order/route.ts:37`) — never trust a client-sent amount.
- Payment signature = `HMAC_SHA256(orderId|paymentId, key_secret)`, timing-safe compare (`razorpay.ts:34-41`).
- Webhook signature = `HMAC_SHA256(rawBody, webhook_secret)` against `x-razorpay-signature` header — must read raw body (`request.text()`), not parsed JSON, or signature check breaks.
- `markJobPaid()` is idempotent — both verify and webhook paths check `job.paidAt` first, safe to fire twice.
- Webhook always returns 200 for handled/unknown events so Razorpay doesn't retry forever.
- `jobId` for webhook lookup travels in `order.notes` set at creation — don't drop that field if you touch order creation.

## Testing

- Test mode: use [Razorpay test cards](https://razorpay.com/docs/payments/payments/test-card-upi-details/) (no real charge).
- Test webhook locally: Razorpay Dashboard → Webhooks → send test event, or use `razorpay-cli`/ngrok tunnel to localhost.
- Minimum order amount enforced: ₹1 (100 paise) — jobs priced below that reject with 400.

## Common issues

| Symptom | Cause |
|---|---|
| Pay button missing, UPI QR shown instead | `RAZORPAY_KEY_ID`/`SECRET` not set — feature silently disabled |
| 401 from order creation | Wrong/mismatched key id+secret pair |
| Webhook 400 | Wrong `RAZORPAY_WEBHOOK_SECRET`, or body was parsed before signature check |
| Payment succeeds but job not marked paid | Check webhook is registered and reaching `/api/payments/webhook`; verify route is the primary path, webhook is just backup |
