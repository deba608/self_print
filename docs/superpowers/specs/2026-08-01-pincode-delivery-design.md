# Pincode-Gated Delivery — Design

**Date:** 2026-08-01
**Status:** Approved (Approach A — DB allowlist)

## Problem

SelfPrint shop serves only its local area. Home delivery must be restricted to serviceable pincodes. Counter pickup remains open to everyone.

## Scope

- Gate **home delivery only** by customer pincode.
- Pickup flow unchanged.
- Admin can manage the serviceable pincode list from the dashboard (no redeploy).

## Data Model

- Add `service_pincodes` TEXT column to `pricing_config` (comma-separated 6-digit pincodes, e.g. `"560001,560002"`).
  - SQLite: auto-migration via the existing `PRAGMA table_info` / `ALTER TABLE` pattern in `src/lib/db.ts`.
  - Supabase: SQL migration adding the column to `pricing_config`.
- Add `delivery_pincode` TEXT column to `jobs` (nullable; set only for delivery jobs). Same dual migration.
- **Empty/null list = delivery available everywhere** (backward compatible; also the "not configured yet" state).

## Types

- `PricingConfig` gains `servicePincodes: string[]` (parsed from the comma-list in both db layers).
- `Job` gains `deliveryPincode: string | null`.

## API

- `GET /api/pricing`: response includes `servicePincodes` (already fetched by UploadForm — no new endpoint).
- `POST /api/jobs`: for `deliveryMethod === "delivery"`, require a valid 6-digit `deliveryPincode`; if the allowlist is non-empty and the pincode is not in it, return 400 with a clear message. Store pincode on the job.
- `PUT /api/admin/pricing`: accepts updated `servicePincodes`; validates each entry is exactly 6 digits; dedupes.

## Customer UI (UploadForm)

- When "Home delivery" selected: required 6-digit pincode input alongside the address field.
- Client-side check against `pricing.servicePincodes`:
  - Serviceable → normal flow.
  - Not serviceable → inline notice "Delivery not available for {pincode} yet — pickup only" and disable submit until customer switches to pickup or changes pincode.
- Pincode shown in the review/summary section with the address.
- Server remains the enforcement point; client check is UX only.

## Admin UI (PricingPanel)

- New field: serviceable pincodes editor (simple comma-separated text input or chip list; validates 6-digit entries before save).
- Job detail / JobCard: show delivery pincode with the address.

## Error Handling

- Client: malformed pincode (not 6 digits) blocks submit with inline message.
- Server: 400 `"Delivery not available for this pincode"` on non-serviceable; 400 on malformed pincode for delivery jobs.
- Race (admin removes pincode mid-session): server check catches it; client surfaces the 400 message.

## Testing

- Unit tests (vitest): pincode parse/validate helpers; allowlist check logic (empty list allows all; membership check; malformed rejection).
- API-level: `POST /api/jobs` delivery rejection path.

## Out of Scope (YAGNI)

- GPS-radius validation (lat/lng capture stays as-is, informational only).
- Per-pincode delivery fees.
- Separate `service_pincodes` table (comma-column suffices for one shop; revisit if multi-shop).
- Gating the upload/pickup flow.
