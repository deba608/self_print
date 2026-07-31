# Delivery Man Role — Design

## Purpose

Add a new staff role, `delivery`, so print-shop delivery riders can log in, see a pool of paid/printed delivery orders, self-claim one, and mark it delivered — without giving them admin access to pricing, file previews, or the full job queue.

## Auth & Accounts

- Extend `staff_profiles.role` check constraint: `role in ('super_admin', 'admin', 'delivery')`.
- Delivery staff authenticate through the same Supabase Auth flow as admin (magic-link/password per existing user-management system). No separate credential system.
- Super admins create delivery accounts via the existing staff-invite UI, with `Delivery` added to the role picker.
- A `delivery`-role user hitting `/admin` is redirected to `/delivery`; a `delivery` user is blocked from admin-only API routes (pricing, customer management, non-delivery job actions) by `requireAdmin`-equivalent checks scoped to role.
- **Implementation note (2026-08-01):** the current `requireAdmin()` in `src/lib/security.ts` accepts *any* `staff_profiles` row with no role check — adding a `delivery` role without changing it would grant riders full admin API access. `requireAdmin` must be changed to reject `role = 'delivery'`, and a separate `requireStaff()` (any role) guard added for the delivery API routes.
- **Implementation note:** the shipped migration `20260728000000_add_delivery_role.sql` references `auth.users(id)` for `jobs.delivery_person_id` (not `staff_profiles(id)` as originally drafted) — equivalent in practice since staff_profiles.id = auth user id; keep as shipped.
- **Implementation note:** delivery dashboard is Supabase-only (staff auth doesn't exist in the SQLite fallback), same as the admin login. API routes call Supabase directly (RPCs), not the dual-db `src/lib/db.ts` layer.

## Assignment Model — Pool / Self-Claim

No manual assignment step. Reuses the existing `delivery_status` enum (`out_for_delivery`, `delivered`) already used by the admin delivery-status route — "claiming" an order *is* the existing out-for-delivery transition, just triggered by a delivery-role user instead of admin.

New column: `jobs.delivery_person_id uuid references staff_profiles(id)`, nullable.

**Pool membership** (a job is "available"):
- `delivery_method = 'delivery'`
- `status = 'printed'`
- `paid_at is not null`
- `delivery_status is null`

**Claiming**: sets `delivery_status = 'out_for_delivery'` and `delivery_person_id = <self>` atomically (conditional update — fails if another rider claimed it first, surfaced as a 409/"already claimed" to the UI).

**My Deliveries**: jobs where `delivery_person_id = self` and `delivery_status = 'out_for_delivery'`.

**Completion**: rider marks delivered — sets `delivery_status = 'delivered'`. Job drops out of all delivery views. Admin dashboard already shows delivered state.

Admin retains override capability via the existing `/api/admin/jobs/[id]/delivery-status` route (unchanged) — e.g. to reassign or force-correct a stuck order.

## New Surfaces

### `/delivery` page + `DeliveryDashboard` component
Two sections:
- **Available** — unclaimed pool, sorted oldest-first, each with a Claim button.
- **My Deliveries** — orders claimed by the logged-in rider, each with a Mark Delivered button.

Live updates via the existing SSE broadcast mechanism (same `sseClients` used by admin dashboard) so a claimed order disappears from other riders' Available list in real time.

### `DeliveryOrderCard` component (new, minimal)
Shows only: customer name, phone, delivery address, map link (built from existing `delivery_latitude`/`delivery_longitude`), page count, amount due. No file preview, no pricing line-items, no admin controls (no edit/cancel/refund).

## API

All under `src/app/api/delivery/`, guarded by a `requireDelivery` check (role `delivery`, `admin`, or `super_admin`):

- `GET /api/delivery/jobs` — returns `{ available: DeliveryOrderView[], mine: DeliveryOrderView[] }`. `DeliveryOrderView` is a new, narrow serializer — never reuses the full `Job` type — so file paths/pricing breakdown can't leak to the client.
- `POST /api/delivery/jobs/[id]/claim` — conditional update (`where delivery_status is null`); 409 if already claimed.
- `POST /api/delivery/jobs/[id]/delivered` — only succeeds if `delivery_person_id = self` (admin/super_admin may override).

Existing admin delivery-status route (`src/app/api/admin/jobs/[id]/delivery-status/route.ts`) is untouched.

## Database

New migration `supabase/migrations/<ts>_add_delivery_role.sql`:
- Drop/recreate `staff_profiles` role check constraint to include `'delivery'`.
- `alter table jobs add column delivery_person_id uuid references staff_profiles(id)`.
- Index: `jobs (delivery_status, delivery_person_id)` where `delivery_method = 'delivery'`.

### RLS
- `staff_profiles`: existing "staff can read all staff profiles" policy already covers delivery role (role-agnostic read for any authenticated staff row).
- `jobs`: new policy — `delivery`-role users may `select` rows where `delivery_method = 'delivery'`; may `update` only `delivery_status`/`delivery_person_id` columns, and only where the row is unclaimed or `delivery_person_id = auth.uid()`. Column-level restriction enforced via a `security definer` RPC (`claim_delivery_job`, `complete_delivery_job`) rather than raw table grants, so riders can't update arbitrary columns (price, status, file paths) even if RLS row-check passes. The two API routes call these RPCs.

## Out of Scope

- Multi-rider assignment history / reassignment audit log.
- Delivery-man analytics (deliveries/day, earnings).
- Push notifications to riders (SSE + manual refresh is enough for v1).
- Rider location tracking beyond the existing customer-consented pickup pin.
