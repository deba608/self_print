# WhatsApp Integration Plan — SelfPrint

Plan for sending WhatsApp messages from SelfPrint: OTP login, order updates, payment receipts, delivery tracking, and review requests. Written 2026-08-01.

---

## 1. What WhatsApp will do for each service

| SelfPrint event | Message to | Template category | Example |
|---|---|---|---|
| Customer login / signup OTP | Customer | **Authentication** | "*123456* is your SelfPrint verification code." (copy-code button) |
| Job created (upload done) | Customer | Utility | "Order *480113* received — 4 pages, ₹21.50. Track: link" |
| Payment received | Customer | Utility | "Payment of ₹21.50 received for order *480113*. Receipt: link" |
| Print ready for pickup | Customer | Utility | "Order *480113* is printed — show this token at the counter." |
| Out for delivery | Customer | Utility | "Your order is out for delivery with {{rider_name}}. Call: {{rider_phone}}" |
| Delivered | Customer | Utility | "Delivered! Rate us: {{review_link}}" |
| New paid job alert | Shop owner (you) | Utility (to your own number) | "New paid order *480113* — 4 pg B&W, delivery to 713347 (Sitarampur)" |
| OTP for staff/rider login (optional) | Staff | Authentication | same as customer OTP |

Notes:
- **Utility** templates = transactional, cheap, allowed after user opt-in.
- **Authentication** templates = OTP-specific format Meta enforces (code + expiry, no links except copy-code button).
- **Marketing** (promos, "20% off color prints") is a separate, costlier category — out of scope here, easy to add later.

---

## 2. Provider choice

Two realistic paths:

### Option A — Meta WhatsApp Cloud API directly (recommended to start)
- Official, no middleman, free service conversations; you pay Meta per template conversation.
- India pricing (approx, check current): Authentication ~₹0.125/msg, Utility ~₹0.125/msg. First 1,000 service conversations/month free.
- Needs: Meta Business account + business verification. Verification can take days and needs business documents (GST/udyam/shop licence helps).
- You get a test number instantly (sandbox) — can build everything before verification completes.

### Option B — BSP (Business Solution Provider): MSG91, Gupshup, AiSensy, Twilio
- They resell the same API with a dashboard, easier onboarding, template management UI, and often bundled SMS-OTP fallback.
- Adds per-message markup (~₹0.02–0.10) or monthly fee.
- **MSG91 or Gupshup** are the India-friendly picks; MSG91 also gives SMS fallback in one API (useful: OTP over SMS when user has no WhatsApp).

**Recommendation**: start with Meta Cloud API direct (Option A). Move to a BSP only if business verification stalls or you want SMS fallback bundled.

---

## 3. Setup steps (Meta Cloud API)

### Step 1 — Meta Business + App
1. Create/verify Meta Business Portfolio at business.facebook.com (use your shop's real name; keep GST/shop-licence documents ready).
2. Go to developers.facebook.com → Create App → type **Business**.
3. In the app dashboard, add product **WhatsApp**. This creates a WhatsApp Business Account (WABA) + a **test phone number** with ₹0 cost you can message up to 5 recipient numbers.

### Step 2 — Phone number
1. Add your shop's number (a number NOT currently registered on the WhatsApp consumer/Business app — it gets converted; take a dedicated SIM or virtual number).
2. Verify via SMS/voice OTP.
3. Set display name (e.g. "SelfPrint Xerox") — Meta reviews it against your business name.

### Step 3 — Credentials
Collect and put in `.env` (server-side only, NEVER `NEXT_PUBLIC_*`):
```
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_BUSINESS_ACCOUNT_ID=1234567890
WHATSAPP_ACCESS_TOKEN=EAAG...        # System User token, NOT the 24h temp token
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<random string you invent>
WHATSAPP_APP_SECRET=<from app settings, for webhook signature check>
```
Access token: create a **System User** in Business Settings → assign the app + WABA → generate a permanent token with `whatsapp_business_messaging` + `whatsapp_business_management` permissions. (The token shown on the app dashboard expires in 24h — don't ship that one.)

### Step 4 — Message templates (must be pre-approved by Meta)
Create in WhatsApp Manager → Message Templates. Approval usually minutes–hours for Utility/Auth.

Templates to create:

| Name | Category | Body |
|---|---|---|
| `otp_login` | Authentication | Meta's fixed format: "{{1}} is your verification code." + copy-code button, expiry 10 min |
| `order_created` | Utility | "Your SelfPrint order *{{1}}* is received — {{2}} pages, {{3}}. Track: {{4}}" |
| `payment_received` | Utility | "Payment of {{1}} received for order *{{2}}*. Thank you!" |
| `order_ready` | Utility | "Order *{{1}}* is printed and ready. Show this token at the counter." |
| `out_for_delivery` | Utility | "Order *{{1}}* is out for delivery with {{2}} ({{3}}). It will reach you soon." |
| `order_delivered` | Utility | "Order *{{1}}* delivered. Loved the service? Rate us: {{2}}" |
| `owner_new_order` | Utility | "New paid order *{{1}}* — {{2}}, {{3}}. Open dashboard: {{4}}" |

Rules: no promo language in Utility or it gets reclassified as Marketing (costlier + needs marketing opt-in). Variables `{{n}}` must have example values at submission.

### Step 5 — Webhook (delivery receipts + inbound replies)
1. New API route: `src/app/api/whatsapp/webhook/route.ts`
   - `GET`: echo `hub.challenge` when `hub.verify_token === WHATSAPP_WEBHOOK_VERIFY_TOKEN` (Meta's verification handshake).
   - `POST`: verify `X-Hub-Signature-256` HMAC with `WHATSAPP_APP_SECRET`; process `statuses` (sent/delivered/read/failed) and `messages` (customer replies — at minimum log; later: "STOP" handling for opt-out).
2. In the app dashboard → WhatsApp → Configuration: set callback URL `https://<your-vercel-domain>/api/whatsapp/webhook`, subscribe to `messages`.
3. Store message status against jobs if you want a "WhatsApp delivered ✓" indicator in admin (optional, phase 2).

### Step 6 — Business verification (for production scale)
- Unverified: 250 business-initiated conversations/24h — plenty for one shop starting out.
- Verify business in Business Settings → Security Centre to unlock 1k → 10k → 100k tiers and permanent display name.

---

## 4. Code architecture in SelfPrint

### New files
```
src/lib/whatsapp.ts              # sender: sendTemplate(to, name, vars), phone normalization, error mapping
src/lib/otp.ts                   # OTP issue/verify: hash, expiry, attempt caps
src/app/api/whatsapp/webhook/route.ts   # Meta webhook (GET verify + POST events)
src/app/api/auth/otp/request/route.ts   # POST {phone} -> sends otp_login template
src/app/api/auth/otp/verify/route.ts    # POST {phone, code} -> session
```

### `src/lib/whatsapp.ts` responsibilities
- `sendTemplate(toPhone, templateName, variables: string[])` → `POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages` with `type: "template"`.
- Phone normalization: store/send E.164 (`91` + 10-digit). Reject anything not `/^[6-9]\d{9}$/` before prefixing.
- **No-op when env vars missing** (same pattern as Supabase/SQLite fallback — local dev keeps working without WhatsApp configured).
- Fire-and-forget with try/catch + log: a WhatsApp failure must NEVER fail the order API call. Send after DB commit, not before.
- Simple in-process retry (1 retry on 5xx/429); anything beyond that just logs. No queue infra needed at shop scale.

### OTP design (`src/lib/otp.ts`)
- Generate 6-digit code, store **SHA-256 hash** + `expires_at` (10 min) + `attempts` in a new `otp_codes` table (both DB layers, or Supabase-only since login already requires Supabase).
- Verify: constant-time compare, max 5 attempts, single-use (delete on success), rate limit: max 3 sends per phone per 15 min + reuse existing IP rate limiter (`src/lib/ratelimit.ts`).
- On success: create/link `customer_profiles` by phone; issue session (this can replace or complement current email login — decide at implementation).
- SMS fallback: SKIPPED for now (owner decision 2026-08-01, cost saving) — WhatsApp-only. If a customer has no WhatsApp, they use email login or guest checkout; revisit only if support requests pile up.

### Hook points for notifications (existing code)
| Event | Where to call sendTemplate |
|---|---|
| Order created | `src/app/api/jobs/route.ts` after `createJob`/`createJobWithFiles` (both paths) — customer phone exists for delivery orders; pickup guests without accounts have no phone (skip) |
| Payment received | wherever `markJobPaid()` is called (payments routes + admin mark-paid) |
| Print ready | agent/status route when status → `printed` (pickup orders) |
| Out for delivery | `src/app/api/delivery/jobs/[id]/advance/route.ts` on → `out_for_delivery` (rider name/phone available from staff_profiles) |
| Delivered | same route on → `delivered`; include `SHOP_REVIEW_URL` |
| Owner alert | payment-received hook, send to `SHOP_OWNER_WHATSAPP` env number |

### Opt-in (required by Meta policy)
- Add a checkbox on the delivery form / signup: "Send order updates on WhatsApp" (default ON is allowed for transactional if disclosed; keep a stored flag `whatsapp_opt_in` on the job or profile).
- Honour inbound "STOP" (webhook) by flagging the phone opted-out.

---

## 5. Cost estimate (one shop, India)

Assume 300 orders/month, ~4 messages per order + 200 OTPs:

| Item | Qty | Rate | Monthly |
|---|---|---|---|
| Utility msgs | ~1,200 | ₹0.125 | ~₹150 |
| Auth (OTP) | ~200 | ₹0.125 | ~₹25 |
| **Total** | | | **~₹175/mo** |

Free tier (1,000 service conversations) doesn't apply to business-initiated templates, so budget the above. A BSP adds ~₹50–200/mo on top.

---

## 6. Build order (phases)

**Phase 1 — foundation + OTP (1 branch)**
1. `src/lib/whatsapp.ts` + env plumbing + no-op fallback (unit tests with fetch mocked)
2. Webhook route (verify handshake + signature check)
3. `otp_codes` table + `src/lib/otp.ts` + request/verify routes + rate limits
4. Login UI: phone → OTP screen

**Phase 2 — order notifications (1 branch)**
5. Templates approved in Meta → template name catalog in code
6. Hook points: order_created, payment_received, order_ready
7. Opt-in checkbox + opt-out handling

**Phase 3 — delivery + owner (1 branch)**
8. out_for_delivery / order_delivered in rider advance route
9. owner_new_order alert
10. Admin indicator for message delivery status (optional)

**Prerequisites before any code**: Step 1–4 of setup (Meta app, number, token, templates submitted) — template approval is the long pole; submit early.

---

## 7. Checklist

- [ ] Meta Business Portfolio created, documents ready
- [ ] Developer app + WhatsApp product added (test number works)
- [ ] Dedicated phone number added + display name approved
- [ ] System User permanent token generated
- [ ] 7 templates submitted and approved
- [ ] Env vars set locally + Vercel
- [ ] Phase 1 built + OTP tested on your own number via test number
- [ ] Business verification submitted (for scale + name badge)
- [ ] Phase 2, Phase 3
- [ ] Opt-out ("STOP") honoured
