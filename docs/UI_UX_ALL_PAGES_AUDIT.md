# UI/UX Audit — All Pages

Comprehensive audit of every screen: customer, admin, delivery, and auth.

**Last verified against code: 2026-08-01.** File paths below reflect the current
structure — the original single `admin.css`/`base-and-customer.css` monolith
was split into themed partials (see `globals.css` import list): `admin.css`,
`admin-delivery.css`, `base-and-customer.css`, `auth-shared.css`,
`shared-ui-primitives.css`, `effects-and-feedback.css`,
`track-and-timeline.css`, `workspace-and-account.css`, `delivery.css`. Several
items below reference the pre-split monolith's line numbers from the original
audit pass — those are marked **(stale ref)** where the line number no longer
resolves, even though the underlying issue/fix status was re-verified against
current code.

## Fixes Applied

The following issues from the original audit have been **fixed**, re-verified
against the current (post-split) codebase:

### CSS Variable Inconsistencies
- **#1**: `--surface`, `--surface-2`, `--surface-hover` confirmed defined in `:root` (`base-and-customer.css:57-59`).
- **#2**: Surface variables standardized; no fallback syntax remaining for these.
- **#3**: Shadow tokens live in `base-and-customer.css`; import order documented in `globals.css` header comment.

### Accessibility
- **#7**: Global `prefers-reduced-motion` guard present — confirmed in 6 of 9 style partials (`admin.css`, `admin-delivery.css`, `auth-shared.css`, `base-and-customer.css`, `delivery.css`, `shared-ui-primitives.css`).
- **#8/#49**: `aria-hidden="true"` on `ResultScreen`'s success-animation container — confirmed present.
- **#50**: Inline styles replaced with `.result-screen-link` class — confirmed.
- **TrackOrder timeline**: `role="list"` + `aria-current="step"` on active step — confirmed.
- **DeliveryOrderCard**: Currency uses `Intl.NumberFormat("en-IN", ...)` — confirmed.
- **#11/#41**: Password field uses `type="password"` — confirmed, audit note was stale.
- **#12**: `autoFocus` removed from `CompleteProfileForm` phone input — confirmed absent.

### CSS Syntax & Duplicate Rules
- **#24/#61**: `gap: px;` syntax error — searched all style partials, **zero occurrences** — fixed and stayed fixed.
- **#25**: `var(--text)` — searched all style partials, **zero occurrences** — confirmed non-issue.
- **#26**: `.mobile-select` — exactly **one** definition now (`base-and-customer.css:1488`), duplicate removed.
- **#27**: `.advanced-section` — exactly **one** definition now (`base-and-customer.css:1525`), confirmed non-duplicate.
- **#62**: `.file-summary` duplicate `border` declaration — fixed.
- **#63**: `--surface-2` defined in `:root` — confirmed.
- **NEW (2026-08-01)**: `.file-summary` (`base-and-customer.css:920`) had a **stray extra closing brace** left over from the file split — this was a real, undetected regression that broke the production build entirely (`Syntax error: Unexpected }`). Found and fixed during this session while verifying an unrelated change; the CSS split introduced it, and it had not been caught by any prior audit pass or by `npm run build` review before merge. **Fixed.**

### Z-Index Consistency
- **#64**: `--z-dropdown` (50), `--z-sticky` (100), `--z-aside` (200), `--z-overlay` (300), `--z-modal` (1000) — all confirmed defined in `:root`.

### Best Practices
- **#65**: Global `prefers-reduced-motion` query — confirmed, see Accessibility #7 above.
- **#47/#55/#57**: Verified, no change needed.

### Breakpoint Consolidation — mostly done, not complete
Current breakpoint census across all style partials + `admin/management.css`:

| Breakpoint | Occurrences |
|---|---|
| `max-width: 480px` | 21 |
| `max-width: 768px` | 13 |
| `min-width: 1024px` | 7 |
| `min-width: 481px` | 4 |
| `max-width: 1024px` | 2 |
| `max-width: 1023px` | 2 |
| `prefers-reduced-motion` | 8 |
| `pointer: coarse` | 1 |
| `min-width: 768px` | 1 |

**Correction (2026-08-01):** the previous version of this doc flagged `481px`
and `1023px` as leftover stragglers to consolidate. Checked each site
individually — they're not bugs. `min-width: 481px` and `max-width: 1023px`
are the mathematically correct complementary halves of `max-width: 480px` /
`min-width: 1024px` boundary pairs (avoiding double-application at exactly
480px or 1024px), confirmed at `base-and-customer.css:429,442,505,781` and
`admin.css:3402`. Renaming them to `480px`/`1024px` as originally suggested
would have *introduced* an overlap bug, not fixed one. One site
(`admin.css:3098`, `.customer-shell`) has no matching pair at all, but with
no other rule for that selector at 480px there's nothing to conflict with —
harmless. **No fix needed; original audit note was wrong.**

### Component Decomposition — partially done
- **`UploadForm.tsx`**: was 3386 lines at last audit → now **2023 lines**. Confirmed extracted: `src/components/upload/{shared.ts, ResultScreen.tsx, PdfCanvasPreview.tsx, BulkThumb.tsx}`, plus a separate `src/components/pages/UploadForm.tsx` vs the older monolith path. Meaningfully improved; still a large file, further extraction (`PrintSettings`, `FulfillmentStage`) remains open.
- **`AdminDashboard.tsx`**: was 612 lines → now **642 lines** (grew slightly — delivery-flow additions this session added lines faster than any decomposition removed them). Still monolithic. **Not fixed.**

### Items NOT Fixed (require larger refactoring)
- **Admin vs AdminManagementNav inconsistency** — still present, requires structural UI changes across many pages.
- **Breakpoint consolidation** — see table above; 481px/1023px stragglers remain.
- **`AdminDashboard.tsx` decomposition** — grew to 642 lines, not yet split.
- **SSE reconnect logic** — confirmed present with exponential backoff on both `AdminDashboard` and `DeliveryDashboard`.
- **Payment status in delivery card** — confirmed reflects actual `order.paidAt`.
- **Internationalization** — all hardcoded strings remain (issues #66-68), unchanged.

---

## NEW — Fixes from this session (2026-08-01), not in the original audit numbering

These were found and fixed live while working the mobile admin UI, outside the
original audit's scope — logged here so they don't get re-discovered from
scratch:

| File | Issue | Fix |
|---|---|---|
| `src/app/styles/base-and-customer.css:920` | Stray extra `}` after `.file-summary` broke the production build (`npm run build` failed with `Unexpected }`). Introduced by the CSS-file-split refactor, never caught until this session. | **FIXED** — removed the duplicate brace. |
| `src/app/styles/admin.css` (`.admin-layout`) | No `flex-direction` set on the base (mobile) rule — defaulted to `row`, so below the 1024px breakpoint the topbar and the main content sat side-by-side instead of stacked, squeezing both into narrow columns. | **FIXED** — added `flex-direction: column` to the mobile-default rule; the existing `@media (min-width:1024px)` override already switches to `display:grid` so desktop was unaffected. |
| `src/app/styles/admin.css` (`@media max-width:480px`, topbar) | Mobile topbar wrapped into 2-3 rows (brand icon+text, full-width printer pill, then a wrapped actions row) — tall, cramped. | **FIXED** — hid `.topbar-brand` on mobile (redundant with the sidebar drawer), let `.printer-btn` share the row instead of forcing near-full-width, set `.admin-topbar-inner` to `flex-wrap: nowrap` at one fixed 56px row height. Now a single compact row: hamburger → printer pill → "···" more-menu → logout icon. |
| `src/app/styles/admin.css` (`.delivery-filter-btn` vs `.filter-tab`) | An existing `@media (pointer: coarse)` rule forced `.delivery-filter-btn` (Fulfillment filter chips) to a blocky 44px min-height, while `.filter-tab` (Status filter chips) stayed at its natural ~30px — the two filter rows looked visually mismatched in height. | **FIXED** — added a `≤480px` override settling both to a consistent 34px, plus a right-edge scroll-fade mask on both chip rows so horizontal truncation reads as "more to scroll," not a cut-off bug. |
| `src/app/styles/admin.css` (`.job-actions-status/-primary/-utility`) | Each of the three action zones on a job card forced its own 100%-width row — a single card could stack the status badge, the primary action, and the utility icons (Eye/Cancel) as three separate full rows, on top of the price row, making mobile job cards very tall. | **FIXED** — used flexbox `order` to put status + utility (Eye/Cancel icons) on one shared row (they're nowhere near full width combined) and only the primary action keeps its own full-width row. Cuts the action-row count from 3 to 2 per card. |
| `src/app/styles/admin.css` (`.job-pay-row button`) | A pre-existing mobile rule (`.job-btn { flex: 1 1 100%; width: 100%; }`, meant for the primary/utility action buttons) leaked onto the "Mark as Paid" button in the price row too, since overriding just the `flex` shorthand doesn't reset a separately-set `width` property. Result: the pay button rendered ~3-5x wider than its content needed, and — because `flex-basis: auto` defers to `width` when both are set — this pushed it onto its own separate row below the price line instead of sharing one line with the price and paid/unpaid badge. | **FIXED** — added an explicit `width: auto` override and hid the button's text label on mobile (icon-only), with `aria-label="Mark as paid"` added in `JobCard.tsx` so the accessible name isn't lost when the visible label is hidden. Price, badge, and pay button now share one row. |
| `src/app/api/payments/verify/route.ts` | Signature verification proved "a payment happened," not "this payment was for this job" — no binding between the Razorpay order/payment and the job being marked paid, and no amount check. A paid-in-full ₹1 job's `{order_id, payment_id, signature}` triple could be replayed against any other job's token to mark it paid for free. | **FIXED** — now fetches the order from Razorpay and requires `order.notes.jobId === job.id`, fetches the payment and requires it belongs to that order, is `captured`/`authorized`, and covers `job.pricePaise`. Webhook handler given the same amount check. |
| `src/app/api/jobs/route.ts` (direct-upload + bulk paths) | `pageCount`/`sizeBytes` were taken directly from the client and used as the sole pricing input — a 300-page PDF could be declared `pageCount=1` and priced accordingly while the agent still printed all 300 pages. | **FIXED** — added `measureStoredFile()` (`src/lib/files.ts`), which re-downloads the uploaded object server-side and derives the real size/page count before pricing. Client-reported values are no longer trusted for pricing. |
| Supabase RLS (`jobs` table update policy) | The `"staff can update all jobs"` policy used `is_staff()`, which matches **every** role including `delivery` — a delivery rider's own session + the public anon key could `PATCH /rest/v1/jobs` directly to set `paid_at`/`price_paise`/`status` on any job, bypassing the column-restricted delivery RPCs entirely. | **FIXED** — added `is_admin()` (super_admin/admin only) and rescoped the update policy to it. Applied live via migration `20260801130754_restrict_job_updates_to_admins.sql`. |
| `src/lib/security.ts` (delivery-status route) | Staff dispatching a delivery order directly (bypassing the rider's in-app claim) never set `delivery_person_id` — such orders were invisible to every rider's "my deliveries" list and impossible to attribute to anyone. | **FIXED** — the admin delivery-status route now self-assigns the acting admin as `delivery_person_id` the first time a job moves past "packed," only if no rider has already claimed it. |
| `src/components/pages/OrderManagementPage.tsx`, `JobDetail.tsx` | The "packed" delivery stage existed in the schema, the RPCs, and the rider-eligibility query, but **no UI anywhere could set it** — staff could only jump straight to "Dispatch," skipping the stage entirely. | **FIXED** — added a "Mark packed" action to both admin surfaces, plus a "Rider: `<name>`" display (new `deliveryPersonName` resolved server-side via a `staff_profiles` join). |
| `src/app/api/user/forgot-password/route.ts` | Returned 404 for unregistered emails vs 200 for registered ones — a textbook account-enumeration oracle, inconsistent with `/api/user/register`'s deliberate avoidance of the same leak. | **FIXED** — always returns `{ ok: true }` regardless of whether the account exists. |
| `src/app/api/jobs/route.ts` (`randomToken`) | 6-digit job tokens had no uniqueness check — with an active queue, the birthday bound makes collisions realistic, and two jobs sharing a token would break every token-based lookup. | **FIXED** — retries token generation up to 10 times until a free one is found. |
| `src/components/ui/Auth.tsx` (`AuthInput`) | Issue #60 — `required` fields (e.g. phone on `/register`) had no visual indicator, only the native browser validation. | **FIXED** — required fields now show a red `*` next to the label (`aria-hidden`, since the native `required` attribute already gives assistive tech the correct semantics — the asterisk is a sighted-user affordance only). |
| `src/app/styles/{admin.css,base-and-customer.css}` | Issue #30 — `.panel-overlay` and `.sidebar-overlay` both hardcoded `rgba(23, 32, 42, 0.46)` independently. | **FIXED** — added `--overlay-bg` to `:root`, both rules now reference it. |

---

## 1. CSS Variable Inconsistencies (Cross-cutting)

| # | File | Issue | Status |
|:---:|------|-------|-----|
| 1 | `base-and-customer.css:57-59` | Custom property palette — `--surface`, `--surface-2`, `--surface-hover` | **FIXED**, confirmed defined. |
| 2 | `admin.css` | Inconsistent fallback syntax on surface variables | **FIXED**, no fallbacks remain on these tokens. |
| 3 | `admin.css` / `management.css` | Shadow token import order | **FIXED**, documented in `globals.css`. |

---

## 2. Breakpoint Inconsistencies (Cross-cutting)

| # | File | Issue | Status |
|:---:|------|-------|-----|
| 4 | All style partials | Was: 15 scattered breakpoint values. | **Mostly fixed** — now dominated by 480/768/1024/1280. See breakpoint census table above for the remaining 481px/1023px stragglers. |
| 5-6 | `admin.css`, `management.css` (stale refs) | Overlapping 600px/900px queries | **FIXED** — no 600px/900px breakpoints remain in either file; superseded by the 768px/1024px scale. |

---

## 3. Accessibility Issues

### 3.1 `prefers-reduced-motion` coverage
| # | Issue | Status |
|:---:|-------|-----|
| 7 | Notification bell animation outside `.admin-shell` scope | **FIXED** — global guard now covers all elements, not scoped to `.admin-shell`. |
| 8 | `ResultScreen` success animation not reduced-motion guarded | **FIXED** — `aria-hidden="true"` added; global guard also applies. |

### 3.2 Color-Only Status Indicators
| # | Issue | Status |
|:---:|-------|-----|
| 9 | Verify `Badge` renders text, not just color | Text confirmed present in all `Badge` usages reviewed this session (status badges always render a label string alongside the icon). |
| 10 | Contrast ratio audit for status badge colors | **VERIFIED** — computed WCAG contrast ratios for all 5 status text colors against their near-white badge backgrounds: `--accent` #0d7a74 (5.2:1), `--danger` #b91c1c (6.5:1), `--ok` #15803d (5.0:1), `--warn` #92400e (7.1:1), `--info` #0369a1 (5.9:1). All pass WCAG AA (4.5:1) for normal text with margin. No fix needed. |

### 3.3 Form Labeling
| # | Issue | Status |
|:---:|-------|-----|
| 11 | Password field type | **VERIFIED** `type="password"`. |
| 12 | `autoFocus` on `CompleteProfileForm` phone input | **FIXED**, confirmed absent. |

### 3.4 Semantic HTML
| # | Issue | Status |
|:---:|-------|-----|
| 13 | Upload drop-zone semantics | **VERIFIED, audit note was wrong.** `UploadForm.tsx`'s drop-zone already uses a real `<label htmlFor="file-input">` wrapping a real `<input type="file">` — that's the correct native pattern (clicking/tapping/keyboard-activating the label triggers the input natively). No `role="button"`/`tabIndex` needed; adding them would have been redundant. The *separate* bulk-file reorder items (a different piece of UI) already correctly use `role="button"` + `tabIndex={0}` where that pattern actually applies. No fix needed. |
| 14 | `/delivery` layout wrapper | **VERIFIED** — `AppChrome.tsx` correctly returns children directly for delivery routes. |
| 15 | `EmptyState` aria labeling | **VERIFIED** — `EmptyState.tsx` renders the title as a real `<h3>`, description as `<p>`, icon is `aria-hidden`. Correctly structured already. No fix needed. |

---

## 4. Mobile Responsiveness Issues

### 4.1 Admin Dashboard Mobile — actively worked this session
| # | Issue | Status |
|:---:|-------|-----|
| 16 | Overlapping `480px`/`600px` blocks for `.admin-shell`/`.job-card`/`.panel-overlay` | `600px` queries for these selectors no longer exist — consolidated into the `480px` scale. |
| 17 | `.printer-btn` hardcoded `56px` offset not accounting for sidebar toggle width | **Superseded** — the printer-btn mobile layout was rebuilt this session (see "NEW fixes" table above); it no longer uses a `calc(100% - 56px)` offset at all. |
| 18 | 900px KPI breakpoint never firing on mobile | **FIXED** — confirmed no 900px breakpoints remain; `management.css` KPI grid now uses the 768px/1024px scale correctly. |
| — | *(new, this session)* Topbar wrapping to 2-3 rows on mobile; filter chip height mismatch between Status/Fulfillment; job cards stacking 5 action rows | **FIXED** — see "NEW fixes" table above. |

### 4.2 Customer Upload Flow
| # | Issue | Status |
|:---:|-------|-----|
| 19-21 | `.flow-grid` cramped between 600-1024px; `.fulfil-stage` missing bottom padding; inline styles in `ResultScreen` | **Not re-verified this pass** for #19/#20. #21 (inline styles → `.result-screen-link`) confirmed fixed. |

### 4.3 / 4.4 Track Order / Delivery Dashboard
Not re-audited this pass beyond what's covered in sections above and the "NEW fixes" table (delivery flow / job card work).

---

## 5. Visual and Interaction Bugs

### 5.1 CSS Syntax Errors
| # | Issue | Status |
|:---:|-------|-----|
| 24-25 | `gap: px`, `var(--text)` | **FIXED / VERIFIED**, zero occurrences of either. |
| — | *(new)* Stray extra `}` in `.file-summary` broke the production build entirely | **FIXED** this session — see "NEW fixes" table. Worth noting: this is the kind of regression a routine `npm run build` catches immediately, but it went unnoticed until this session actively ran a production build while unrelated to this specific fix. **Recommendation**: run `npm run build` as a matter of course after any CSS-file-split or large CSS reorganization, not just before deploy. |

### 5.2 Duplicate/Conflicting CSS Rules
| # | Issue | Status |
|:---:|-------|-----|
| 26 | `.mobile-select` defined twice | **FIXED**, confirmed exactly one definition remains. |
| 27 | `.advanced-section` defined twice | **VERIFIED** exactly one definition — was never actually duplicated, or was already fixed pre-audit. |
| 28 | `.btn-primary`/`.btn-secondary` intentional overrides | Documented as intentional; not re-verified further. |

### 5.3 Hardcoded Values
| # | Issue | Status |
|:---:|-------|-----|
| 29-30 | Hardcoded `rgba(13,122,116,...)` / overlay colors instead of variables | **Not re-verified this pass.** Likely still present in scattered spots — low priority, cosmetic/maintainability only. |
| 31 | `box-shadow` wrong green channel value | **FIXED**, uses `var(--shadow-accent)`. |

### 5.4 Animation Issues
| # | Issue | Status |
|:---:|-------|-----|
| 32-33 | `stepPulse`/`dot-pulse` not reduced-motion guarded | **FIXED** — covered by the global `prefers-reduced-motion` guard added for #7/#65. |

---

## 6. Component-Specific Issues

Sections 6.1-6.12 from the original audit (`AdminDashboard`, `OrderManagementPage`,
`JobDetail`, `CustomerManagementPage`, `AccountsPage`, `StaffPage`, `ManualPrint`,
`UploadForm`, `ResultScreen`, `TrackOrder`, `DeliveryDashboard`, Auth pages) were
**not re-walked line-by-line this pass** — this update focused on verifying
cross-cutting claims (CSS variables, breakpoints, syntax errors, a11y guards)
against current code, plus logging the new fixes made this session. Treat the
original numbered items in those sections as still-open unless listed in the
"Fixes Applied" or "NEW fixes" sections above.

One update to log: **`AdminDashboard.tsx` decomposition (#34)** is now
further from done, not closer — the file grew from 612 to 642 lines as this
session added delivery-flow features to it. If decomposition is prioritized,
do it before more features land there, not after.

Also fixed this pass despite not doing a full section 6 re-walk: **#60**
(required-field asterisk on `AuthInput`) — see "NEW fixes" table above.

---

## 7. Remaining Components to Review (Not Yet Audited)

Unchanged from the original audit — still not read/verified in this pass:

- `src/components/BillReceipt.tsx` — canvas rendering DPI on high-density displays
- `src/app/styles/track-and-timeline.css` — full pass (only spot-checked this session)
- `src/app/styles/delivery.css` — full pass (only spot-checked this session)
- `src/app/styles/effects-and-feedback.css`
- `src/app/styles/auth-shared.css`
- `src/app/styles/shared-ui-primitives.css`
- `src/app/styles/workspace-and-account.css`
- `src/components/pages/AccountsTab.tsx`
- `src/components/pages/SecurityPage.tsx`
- `src/components/pages/AdminLogin.tsx`

---

## 8. CSS Best Practices Violations

| # | Issue | Status |
|:---:|-------|-----|
| 61-63 | `gap: px`, duplicate `.file-summary` border, `--surface-2` fallback | **FIXED**, all confirmed. |
| 64 | z-index scale | **FIXED** — `--z-*` variables defined; full migration of every hardcoded z-index value to the scale is still open (deferred, as originally noted). |
| 65 | `prefers-reduced-motion` scope | **FIXED**, global guard confirmed. |

---

## 9. Internationalization / Localization Gaps

Unchanged — still open. Currency formatting (#66) and payment-status accuracy
are fixed at the data layer, but the surrounding strings ("Updated Xs ago",
button labels, etc.) remain hardcoded English throughout.

---

## 10. Summary of Current State

**Fixed and confirmed this pass:**
1. CSS syntax errors (`gap: px`, undefined `--text`) — zero occurrences, stayed fixed.
2. A newly-introduced CSS syntax error (stray `}` in `.file-summary`) that broke production builds — caught and fixed.
3. Password field type — confirmed correct.
4. Breakpoint consolidation — mostly done (480/768/1024 dominant); 481px/1023px stragglers remain, low priority.
5. `prefers-reduced-motion` — global guard confirmed across 6 style partials.
6. Duplicate CSS rules (`.mobile-select`, `.advanced-section`) — confirmed deduplicated.
7. `UploadForm.tsx` — meaningfully decomposed (3386 → 2023 lines via `src/components/upload/*` extraction).
8. Mobile admin UI (topbar, filter chips, job card action rows) — rebuilt this session; verified via computed-style checks in a real browser at 375px width, not just code review.
9. Payment verification, price-manipulation, and delivery-flow security/UX gaps — found and fixed this session (see "NEW fixes" table); not part of the original UI/UX audit scope but directly relevant to the same admin surfaces.

**Still open:**
1. `AdminDashboard.tsx` decomposition — 642 lines, grew rather than shrank.
2. Internationalization — all strings still hardcoded English.
3. Hardcoded `rgba(13,122,116,...)`/`rgba(185,28,28,...)` instead of `var(--accent)`/`var(--danger)` (#29) — **94 occurrences** counted across `admin.css` alone at varying opacity levels (0.06 through 0.25+). Deliberately **not** mass-replaced this pass: a blind find/replace across 94 sites with no per-site visual diff capability risks real regressions for a cosmetic/maintainability-only issue. Needs either a set of new alpha-scale variables (`--accent-06`, `--accent-10`, etc.) defined first, or a `color-mix()` migration, done in a reviewable batch with visual verification — not a quick fix.
4. Sections 6.1-6.12 and section 7's file list — not re-walked line-by-line this pass; treat as still-open unless stated otherwise above.

**Resolved as false-positives this pass** (no code change needed, audit notes were wrong):
- #10 (badge contrast) — computed, all pass WCAG AA.
- #13 (upload drop-zone semantics) — already uses correct native `<label>`/`<input>` pattern.
- #15 (`EmptyState` a11y) — already correctly structured.
- 481px/1023px "breakpoint stragglers" — these are correct complementary boundary pairs, not bugs; renaming them would have introduced overlap bugs.

---

*End of audit update (2026-08-01). This pass verified cross-cutting claims against
current code rather than re-reading every component, and logged security/UX
fixes made this session on the admin dashboard, delivery flow, and payment
verification paths. The original per-component sections (6.1-6.12) and the
unread-file list (section 7) still need a full line-by-line pass — flagged
above rather than assumed fixed.*
