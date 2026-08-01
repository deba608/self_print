# Service-Area-Gated Delivery (Hybrid) — Design

**Date:** 2026-08-01 (revised same day: hybrid multi-mode replaces pincode-only)
**Status:** Approved

## Problem

SelfPrint shop serves only its local area. Home delivery must be restricted to the serviceable area. A single pincode can cover a large region while the shop serves only part of it, so the admin needs selectable precision levels. Counter pickup remains open to everyone.

## Scope

- Gate **home delivery only**; pickup flow unchanged.
- Admin picks the gating **mode** from the dashboard and can switch modes anytime (no redeploy):
  - `off` — delivery available everywhere (default; today's behavior)
  - `pincode` — allowlist of 6-digit pincodes
  - `pincode_area` — allowlist of pincodes, each optionally narrowed to named localities; customer picks their locality from a dropdown
  - `radius` — customer's captured GPS must be within N km of the shop (haversine)
  - `polygon` — customer's GPS must fall inside an admin-defined polygon (ray casting); vertices entered as a pasted lat,lng list (no map-drawing UI yet)
- In `radius`/`polygon` modes, GPS location capture becomes **required** for delivery orders (it is optional today).

## Data Model

- Add `service_area_config` TEXT column to `pricing_config` storing JSON (default `''` → mode `off`):

```json
{
  "mode": "pincode_area",
  "pincodes": [
    { "pincode": "713347", "areas": ["Sitarampur", "Chelidanga"] },
    { "pincode": "713343", "areas": [] }
  ],
  "radiusKm": 5,
  "shopLat": 23.68,
  "shopLng": 86.98,
  "polygon": [[23.69, 86.97], [23.70, 86.99], [23.67, 86.99]]
}
```

  All sections persist regardless of active mode, so switching modes never loses configured data. Empty `areas` = whole pincode serviceable.
- Add `delivery_pincode` TEXT and `delivery_area` TEXT columns to `jobs` (nullable; set for delivery jobs — pincode always collected for delivery regardless of mode, area only in `pincode_area` mode).
- SQLite: auto-migration via existing `PRAGMA table_info` / `ALTER TABLE` pattern; Supabase: SQL migration.

## Types & Core Logic

- New module `src/lib/service-area.ts`:
  - `ServiceAreaMode = "off" | "pincode" | "pincode_area" | "radius" | "polygon"`
  - `ServiceAreaConfig = { mode; pincodes: Array<{pincode: string; areas: string[]}>; radiusKm: number | null; shopLat: number | null; shopLng: number | null; polygon: Array<[number, number]> }`
  - `parseServiceAreaConfig(raw: string | null): ServiceAreaConfig` — defensive; malformed JSON → mode `off`
  - `checkDeliveryServiceable(input: {pincode: string | null; area: string | null; lat: number | null; lng: number | null}, config): { ok: true } | { ok: false; reason: string }` — single enforcement entry point, strategy per mode
  - `haversineKm`, `pointInPolygon` helpers; `isValidPincode` (`/^[1-9]\d{5}$/`)
  - A mode whose own config is unusable (e.g. `radius` with no shop coords, `polygon` with < 3 vertices, `pincode` with empty list) fails open (`ok: true`) — misconfiguration must not silently kill delivery.
- `PricingConfig` gains `serviceArea: ServiceAreaConfig`; `Job` gains `deliveryPincode: string | null` and `deliveryArea: string | null`.

## API

- `GET /api/pricing`: response includes `serviceArea` (already spread from pricing — customer UI uses it for UX checks and the area dropdown).
- `POST /api/jobs` (single and bulk paths): for delivery, always require valid 6-digit `deliveryPincode`; require `deliveryArea` when mode is `pincode_area` and the matched pincode defines areas; require GPS when mode is `radius`/`polygon`. Enforce via `checkDeliveryServiceable`; 400 with the reason on failure. Store pincode + area on the job.
- `PUT /api/admin/pricing`: accepts `serviceArea` object; validates mode enum, pincode formats, area strings non-empty ≤ 60 chars, radius > 0, lat/lng ranges, polygon vertices; persists as JSON.

## Customer UI (UploadForm)

- Delivery selected → required pincode input (all modes — collected for records even in `off`/GPS modes).
- Mode `pincode`/`pincode_area`: instant client check; unserviceable → inline "Delivery not available for {pincode} yet — pickup only", submit blocked.
- Mode `pincode_area` with areas defined for the entered pincode: locality dropdown (from config), required.
- Mode `radius`/`polygon`: location capture required; client shows distance/out-of-area message after capture when check fails.
- Review section shows pincode (+ area when set). Server remains the enforcement point.

## Admin UI (PricingPanel)

- New "Delivery Area" section: mode selector (radio/select) + only the active mode's fields:
  - pincode list editor (one row per pincode; comma-separated areas per row for `pincode_area`)
  - radius km + shop lat/lng inputs
  - polygon textarea (one `lat,lng` per line)
- Job detail / JobCard: show delivery pincode and area with the address.

## Error Handling

- Client: malformed pincode blocks submit; missing required area/GPS blocks submit with inline message.
- Server: 400 with reason from `checkDeliveryServiceable`; 400 on malformed inputs.
- Config race (admin changes mode mid-session): server check catches; client surfaces the 400.
- Malformed stored config JSON → parsed as mode `off` (never crashes checkout).

## Testing

- Unit (vitest): `parseServiceAreaConfig` (defaults, malformed JSON), `checkDeliveryServiceable` per mode incl. fail-open cases, `haversineKm` known distances, `pointInPolygon` inside/outside/edge, pincode validation.
- API-level behavior verified end-to-end in dev server (blocked + allowed paths per mode).

## Out of Scope (YAGNI)

- Map-based polygon drawing UI (paste vertices for now).
- Per-pincode/per-area delivery fees.
- Combining multiple modes simultaneously (one active mode at a time).
- Gating the upload/pickup flow.
