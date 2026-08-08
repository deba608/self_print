# Plan: Spiral Binding + Cover File Add-on Options

## Goal
Add two extra service options to the print queue system:
1. **Spiral Binding** — adds a spiral/comb binding finish to the printed job (₹20 by default)
2. **Cover File** — adds a cover page/file to the printed job (₹10 by default)

Both are optional add-ons chosen by the customer during upload. They add a fixed fee
to the order total. Admin can change the prices from the Pricing panel.

## Architecture

### Database
- `pricing_config` table: add `spiral_binding_paise`, `cover_file_paise` columns
- `jobs` table: add `has_spiral_binding`, `has_cover_file` columns (0/1 booleans)
- `pricing_config` is a key-value table (config_key, config_value), so these are
  just new rows, not schema columns

### PricingModel (shared across SQLite + Supabase)
- `PricingConfig` type gains `spiralBindingPaise` and `coverFilePaise`
- `Job` type gains `hasSpiralBinding` and `hasCoverFile`

### Customer Flow
- UploadForm shows two checkbox options: "Spiral Binding (+₹20)" / "Cover File (+₹10)"
- Price estimate updates live when toggles are flipped
- POST /api/jobs passes flags; price = calculatePrice(...) + (spiral ? spiralPaise : 0) + (cover ? coverPaise : 0)
- ResultScreen and BillReceipt show the line items

### Admin Flow
- PUT /api/admin/jobs/[id] can toggle the flags and recalculate total
- JobDetail SettingsCard shows checkboxes + price adjustment
- JobDetail SummaryCard shows the extra line items
- JobCard shows spiral/cover badges
- PricingPanel has two number inputs for the paise values

### Agent
- print-image.ps1 receives `-SpiralBinding` flag; if set, prints with spiral binding
  (placeholder: passes flag through, actual spiral mechanism is a future print accessory)
- agent index.ts passes `hasSpiralBinding` from job to the print command

## Files to Change

### Types & Config
- src/lib/types.ts — PricingConfig, Job
- src/lib/db.ts — seedDefaults, mapRow (pricing + jobs), createJobWithFiles, updateJobSettings, getPricing, updatePricing
- src/lib/db-supabase.ts — PRICING_DEFAULTS, mapRow (pricing + jobs), createJobWithFiles, updateJobSettings, getPricing, updatePricing
- src/lib/pricing.ts — addAddonPrice / update calculatePrice output
- src/lib/config.ts — nothing needed (config is runtime values)

### API Routes
- src/app/api/jobs/route.ts — read hasSpiralBinding, hasCoverFile from body
- src/app/api/admin/jobs/[id]/route.ts — toggle flags, recalculate total
- src/app/api/admin/pricing/route.ts — handle new fields
- src/app/api/pricing/route.ts — return new fields

### Customer UI
- src/components/pages/UploadForm.tsx — single unified paper size chip bar (A4, A3, A5, Legal, Photo + More dropdown) + spiral/cover toggles + price estimate
- src/components/upload/ResultScreen.tsx — show add-ons in bill
- src/components/BillReceipt.tsx — show add-ons

### Admin UI
- src/app/admin/components/PricingPanel.tsx — inputs
- src/app/admin/components/JobCard.tsx — badges
- src/app/admin/jobs/[id]/JobDetail.tsx — SettingsCard, SummaryCard, ActionsCard

### Agent
- agent/print-image.ps1 — accept -SpiralBinding
- agent/src/index.ts — pass spiral flag
