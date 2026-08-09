# Vercel Memory Runbook

## What is Fluid Provisioned Memory

Vercel charges by **GB·Hours**: function RAM × how long it ran. The Hobby plan
gives 360 GB-Hrs/month.

```
Current usage: ~270 GB-Hrs / 360 GB-Hrs (30-day snapshot, Aug 2026)
Main project:  selfprint — 99.2% of all usage
```

## Why SelfPrint burns memory

### Root cause: SSE streams stay alive

`/api/admin/notifications` (`src/app/api/admin/notifications/route.ts`) returns
a `ReadableStream` that never closes — it sends a heartbeat comment every 25s.
Vercel bills the lambda as **continuously running** the entire time a browser tab
holds the stream open.

```
1 admin tab + 1 delivery tab = 2 streams
Each stream ≈ 128 MB Vercel minimum allocation

24h × 2 streams × 128 MB ÷ 1024 = 6.14 GB-Hrs/day
30 days = ~184 GB-Hrs/month just from two open tabs
```

### Secondary: file upload buffering

`src/lib/storage.ts:80` — `Buffer.from(await file.arrayBuffer())` loads entire
files into lambda RAM. A 25 MB PDF = 25 MB spike per upload invocation.

### The other gotcha: SSE is broken on multi-instance Vercel anyway

`sseClients` is an in-memory Set. When Vercel spins up multiple lambda instances,
a push to one instance's Set never reaches clients on a different instance. It
appears to work only because the Hobby cold-start rate usually means one live
instance at a time.

---

## Fix — when usage exceeds 320 GB-Hrs/month

**Do not act before it's needed.** Both dashboards already have polling fallbacks
that maintain correctness. The only loss is instant-push vs. ≤15s polling delay,
which is acceptable for a print-shop counter.

### Step 1 — Remove SSE from admin dashboard

In `src/components/pages/AdminDashboard.tsx`:

1. Delete the `EventSource` connection block (the `useEffect` that creates `esRef`).
2. Lower `useJobs` poll interval: in `src/hooks/useAdmin.ts` change `refreshInterval: 60000` → `refreshInterval: 15000`.

In `src/components/pages/DeliveryDashboard.tsx`:

1. Delete the `connect()` / `EventSource` block.
2. Lower the fallback `setInterval` from 15000 to 10000.

### Step 2 — Remove SSE broadcast from all API routes

Each of the following routes has a `for (const client of sseClients)` loop —
delete the entire loop and its import:

- `src/app/api/jobs/route.ts`
- `src/app/api/admin/jobs/[id]/status/route.ts`
- `src/app/api/admin/jobs/[id]/reprint/route.ts`
- `src/app/api/admin/jobs/[id]/delivery-status/route.ts`
- `src/app/api/admin/jobs/bulk-delete/route.ts`
- `src/app/api/delivery/jobs/[id]/claim/route.ts`
- `src/app/api/delivery/jobs/[id]/advance/route.ts`
- `src/app/api/jobs/[token]/report/route.ts`

### Step 3 — Delete the SSE route and shared state

- Delete `src/app/api/admin/notifications/route.ts`
- Remove `sseClients` export from `src/lib/db.ts` and `src/lib/db-supabase.ts`
- Remove the `SseClient` type definition

### Step 4 — Stream uploads instead of buffering (optional, minor)

In `src/lib/storage.ts`, replace:

```typescript
// Before
const bytes = Buffer.from(await file.arrayBuffer());
await supabase.storage.from(BUCKET).upload(path, bytes, { ... });

// After — pipe the ReadableStream directly (supabase-js v2 accepts it)
await supabase.storage.from(BUCKET).upload(path, file.stream(), {
  contentType: file.type,
  duplex: "half",
  ...
});
```

This reduces peak RAM per upload invocation from ~file-size to near-zero.

---

## Alternative: upgrade Vercel plan

Vercel Pro gives 1,000 GB-Hrs/month for $20/month. At the current ~270 GB-Hrs/30
days rate this provides headroom without any code changes.

Worth comparing:
- ~270 GB-Hrs × 12 months = ~3,240 GB-Hrs/year of waste from SSE
- Pro = $240/year

The code fix is free and makes the app architecturally more correct (SSE on
multi-instance serverless was already broken). Do the fix.

---

## Region

Supabase is in `ap-south-1` (Mumbai). Vercel should match:

```json
// vercel.json
{ "regions": ["bom1"] }
```

`bom1` = Vercel Mumbai. Cuts Supabase query RTT by ~150ms for Indian users.
Already applied as of Aug 2026.
