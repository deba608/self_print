# Security & Rate Limiting

What SelfPrint implements today, where it lives in the code, and its known limits.

## Rate Limiting

### Mechanism — `src/lib/ratelimit.ts`

A basic in-memory, fixed-window limiter:

- `isRateLimited(bucket, key, maxRequests, windowMs)` — each `bucket` (endpoint) holds a map of `key → { count, lastReset }`. First request in a window resets the counter; requests beyond `maxRequests` within `windowMs` return `true` (caller responds `429`).
- The key is always the client IP via `clientIp(headers)` — first hop of `x-forwarded-for`, falling back to `x-real-ip`, then `"unknown"`.
- Maps are swept lazily when a bucket exceeds 1000 keys.

**Caveats (by design, documented in the file):**

- **Per-instance, not distributed.** On Vercel each serverless instance has its own map, so the effective global limit is `limit × instances`. Good enough to stop a single-source flood; not a hard quota.
- **Fixed window, not sliding.** A burst straddling two windows can briefly double the rate.
- **IP-keyed.** Clients behind one NAT share a bucket; `x-forwarded-for` is trustworthy only because the platform proxy (Vercel) sets it — do not deploy behind a setup where clients can inject it.

### All rate-limited endpoints

| Bucket | Endpoint | Limit | Window | Why |
|---|---|---|---|---|
| `jobs-create` | `POST /api/jobs` | 10 | 1 min | Job/upload spam — each job creates DB rows + stored files |
| `uploads-sign` | `POST /api/uploads/sign` | 5 | 1 min | Signed-URL minting for direct-to-Supabase uploads |
| `file-serve-admin` | `GET /api/uploads/[id]` | 120 | 1 min | File preview serving (admin dashboard iterates jobs) |
| `job-status` | `GET /api/jobs/[token]/status` | 60 | 1 min | Customer status polling on the token page |
| `job-receipt` | `GET /api/jobs/[token]/receipt` | 30 | 1 min | Receipt generation |
| `report-issue` | `POST /api/jobs/[token]/report` | 5 | 10 min | Customer issue reports — writes print_events, pings admins |
| `admin-login` | `POST /api/admin/login` | 8 | 1 min | Staff credential brute force |
| `user-login` | `POST /api/user/login` | 10 | 1 min | Customer credential brute force |
| `user-register` | `POST /api/user/register` | 6 | 1 hour | Account/email spam |
| `forgot-password` | `POST /api/user/forgot-password` | 5 | 1 hour | Password-reset email spam |
| `resend-confirmation` | `POST /api/user/resend-confirmation` | 3 | 10 min | Confirmation email spam |

All limited routes respond `429` with a generic "Too many requests" message.

## Authentication & Authorization

### Staff (admin dashboard)

- Supabase Auth session + a matching `staff_profiles` row, enforced server-side by `requireAdmin()` / `requireAdminResponse()` in `src/lib/security.ts`. No profile row → 401 even with a valid Supabase session.
- Roles: `super_admin`, `admin`, `delivery`. Staff creation is invite-only (only existing admins; first super_admin is created manually in the Supabase dashboard).
- Every staff login attempt (success and failure) is audit-logged to `admin_login_events` with IP, user agent, browser/OS/device, and failure reason.

### Customers

- Optional Supabase Auth accounts; guests can upload without one. Job access for guests is by job token only — a 6-digit number (`crypto.randomInt(100000, 999999)`), chosen short so it can be read out at the counter. See Known Gaps.

### Print agent

- Authenticates to Supabase directly with the **service-role key** in `agent/config.json` (never shipped to a browser). There is no HTTP agent API; the old `/api/agent/*` bearer-token routes were removed as dead code. The `agent_tokens` table (hashed via `src/lib/token-hash.ts`, timing-safe compare) is legacy and no longer consulted.

### Cleanup cron — `/api/cleanup`

- Requires `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends). Compared with `crypto.timingSafeEqual` — no timing side channel.
- Dev-only fallback: if `CRON_SECRET` is unset and `NODE_ENV !== production`, `AGENT_TOKEN` is accepted instead. In production, missing `CRON_SECRET` fails closed.

### Row Level Security (Supabase)

- Customers can read only their own jobs (`customer_user_id = auth.uid()`).
- Staff (`is_staff()`) read/update everything; the `delivery` role sees delivery-method jobs only.
- Delivery claims go through security-definer RPCs (`claim_delivery_job` / `complete_delivery_job`) — column-restricted and race-safe.
- The browser only ever holds the anon key (RLS-enforced); the service-role key stays server-side.

## Upload & File Safety

- **Type allow-list** — `validateUpload()` in `src/lib/files.ts`: MIME **and** extension must both match the allow-list (PDF, JPG/JPEG, PNG). Mismatched pairs (e.g. `.exe` with a PDF MIME) are rejected.
- **Size cap** — `MAX_UPLOAD_MB` (default 25 MB) enforced server-side.
- **Stored names are never user-controlled** — always `<uuid>.<ext>`, validated against `STORED_NAME_RE` in `src/lib/storage.ts`, which blocks path traversal outright.
- **Signed serving** — locally-served files use an HMAC-SHA256 signature (`SESSION_SECRET`-keyed) over the stored name, verified with `timingSafeEqual`. Supabase files are served via short-lived signed URLs from a **private** bucket.
- **Download headers** — `Content-Disposition` filenames are ASCII-sanitized plus RFC 5987 `filename*` encoding, so quotes/CR/LF/non-ASCII in an upload name cannot inject headers.
- **Retention** — file bytes are purged after `FILE_RETENTION_DAYS` (default 3) by the cleanup cron; job metadata is kept for history, `purged_at` marks the purge.

## Payments

- **Razorpay checkout** — `POST /api/payments/verify` recomputes the HMAC-SHA256 payment signature with `RAZORPAY_KEY_SECRET` and compares timing-safe (`src/lib/razorpay.ts`). Amount comes from the server-side job record, never the client.
- **Webhook** — `POST /api/payments/webhook` verifies `x-razorpay-signature` (HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET`) the same way.
- **UPI QR** — display-only; payment is confirmed manually by staff (marks `paidAt`).

## Secrets & Configuration

- `.env` is gitignored; `.env.example` documents every variable without real values.
- `src/lib/config.ts` warns loudly at boot in production if `SESSION_SECRET` is left at its dev default or `AGENT_TOKEN` is unset.
- Service-role key locations: server env (`SUPABASE_SERVICE_ROLE_KEY`) and the shop PC's `agent/config.json` — never in client bundles.

## Known Gaps / Future Hardening

- Rate limiter is per-instance (see caveats above) — a distributed limiter (Upstash/Redis) would make limits real quotas.
- No CAPTCHA on register/login; rate limits are the only bot friction.
- **Job tokens are 6 digits** (900,000 values) and are the sole guard on guest status/receipt endpoints. Rate limits (60/min status, 30/min receipt per IP) slow enumeration from one source, but a distributed scan could enumerate live tokens; exposure is limited to job metadata (status, price, file name — not file bytes) and tokens expire with the job. Hardening option: append a random suffix to the token used in URLs while keeping the 6-digit display form for the counter.
- No CSP/security headers configured in `next.config.ts` yet.
