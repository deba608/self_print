# Pricing System

All monetary values are stored and computed in **paise** (₹1 = 100 paise). The
UI converts to rupees only at display time via `formatRupees()`.

---

## Configuration fields

### Per-page rates

| Field | Description |
|---|---|
| `bwPerPagePaise` | Cost per B&W page, simplex (one-sided) |
| `colorPerPagePaise` | Cost per color page (simplex or duplex — no color duplex discount) |
| `duplexBwPerPagePaise` | Cost per B&W page when printed duplex. Applied to full paired pages only; the trailing odd page always uses `bwPerPagePaise` |
| `photoPrintPaise` | Flat cost per photo print (4×6 in). Bypasses the page formula entirely |

### Paper-size multipliers

Every non-photo job multiplies the page cost by a size factor. A4 is the baseline (×1.0); all other sizes are relative to it.

| Field | Default | Physical basis |
|---|---|---|
| `a4Multiplier` | ×1.0 | Baseline — Letter maps to this too |
| `a3Multiplier` | ×2.5 | A3 = 2× A4 area; extra ×0.5 covers handling overhead and waste risk |
| `a5Multiplier` | ×0.7 | A5 = ½ A4 area; slightly above ×0.5 to cover handling |
| `a6Multiplier` | ×0.5 | A6 = ¼ A4 area; at raw paper cost (very rare, minimal overhead) |
| `b5Multiplier` | ×0.9 | B5 ≈ A4 but slightly smaller; modest discount |
| `legalMultiplier` | ×1.25 | Legal is slightly longer than A4; small premium |
| `photoMultiplier` | ×1.0 | Unused in practice — photo jobs exit before reaching the multiplier |

These defaults are business judgments, not formulas. The admin UI can change any
of them at any time and the change takes effect immediately (cache is cleared on
save).

### Other fields

| Field | Default | Description |
|---|---|---|
| `copyMultiplier` | ×1.0 | Global price adjustment applied to every job. Set >1 for a shop-wide surcharge, <1 for a blanket discount. Has nothing to do with copy count — it multiplies the final total |
| `expiryMinutes` | 1440 (24 h) | How long an unprinted job stays active before expiring |
| `deliveryFeePaise` | 0 | Flat fee added to delivery orders |

---

## Price formula

### Photo jobs

```
price = photoPrintPaise × copies
```

Exits here — page count, duplex, and paper multipliers are all ignored.

### All other jobs

**Step 1 — Count billable pages**

```
selectedPages = selectedPageCount(pageCount, pageRange)
```

`pageRange` is the customer's optional page selection:
- empty / null → full document
- `"even"` → `floor(total / 2)` pages
- `"odd"` → `ceil(total / 2)` pages
- `"1-3,5,8-10"` → parse ranges, deduplicate, count unique pages
- Always at least 1

**Step 2 — Compute page cost**

Simplex:
```
pageCostSum = bwPerPagePaise × selectedPages          (B&W)
            = colorPerPagePaise × selectedPages       (color)
```

Duplex:
```
pairedPages  = floor(selectedPages / 2) × 2   ← even count, use duplex rate
trailingPage = selectedPages % 2              ← 0 or 1, use simplex rate

pageCostSum = (duplexBwPerPagePaise × pairedPages) + (bwPerPagePaise × trailingPage)
```

Color duplex has no separate rate — `colorPerPagePaise` is used for all pages.

**Step 3 — Apply multipliers and round**

```
price = round(pageCostSum × copies × paperMultiplier × copyMultiplier)
```

`Math.round()` eliminates fractional paise.

---

## Worked example

**Job:** 7 pages, B&W, duplex, A3, 3 copies  
**Rates:** `bwPerPagePaise=150`, `duplexBwPerPagePaise=100`, `a3Multiplier=2.5`, `copyMultiplier=1.0`

```
selectedPages = 7
pairedPages   = 6  →  6 × 100 = 600 p
trailingPage  = 1  →  1 × 150 = 150 p
pageCostSum   = 750 p

price = round(750 × 3 × 2.5 × 1.0)
      = round(5625)
      = 5625 p  →  ₹56.25
```

---

## Where values are stored and set

### Initial defaults (code)

`src/lib/db.ts` → `seedDefaults()` — runs on first boot or `npm run db:seed`.
Uses `INSERT OR IGNORE` so it never overwrites existing config.

```
bwPerPagePaise          = 100    (₹1.00)
colorPerPagePaise       = 1000   (₹10.00)
photoPrintPaise         = 3000   (₹30.00)
copyMultiplier          = 1.0
a3Multiplier            = 2.5
a4Multiplier            = 1.0
a5Multiplier            = 0.7
a6Multiplier            = 0.5
b5Multiplier            = 0.9
legalMultiplier         = 1.25
photoMultiplier         = 1.0
duplexBwPerPagePaise    = 100    (₹1.00)
expiryMinutes           = 1440
deliveryFeePaise        = 0
```

### Admin UI

`/admin` → Pricing section → saves all fields via `PUT /api/admin/pricing`.  
Validation: every field must be a number ≥ 0. On success, the in-memory cache
is cleared and the new values take effect immediately for all subsequent jobs.

### Payment gateway config (env vars, not DB)

These are not in `pricing_config` — they live in `.env` and are injected at
runtime by the `/api/pricing` route:

| Variable | Purpose |
|---|---|
| `SHOP_UPI_ID` | UPI VPA for QR/link payment |
| `SHOP_UPI_QR` | Pre-generated UPI QR image URL |
| `SHOP_NAME` | Shop name shown on receipts |
| `RAZORPAY_KEY_ID` | Publishable key — enables Razorpay online payment |

---

## Known edge cases

- `even` page range on a 1-page document returns 0 from `floor(1/2)` — the
  minimum-1 guard in `selectedPageCount` does **not** apply to the `even`/`odd`
  early-return path. Customer would be charged for 0 pages (₹0). Low real-world
  risk since 1-page docs are rarely printed double-sided.
- `copyMultiplier` name is misleading — it is a global price multiplier, not a
  per-copy rate. Leaving it at 1.0 (the default) makes it a no-op.
- Letter paper silently uses `a4Multiplier`. There is no separate Letter rate.
