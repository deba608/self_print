# Self_Print — UI/UX Upgrade Plan

**Date:** 2026-07-23
**Scope:** Polish and unify the UI for all recently added features. Audit finding: every new feature (home delivery, customer accounts, admin auth, staff management) already has a working UI — the gap is not missing screens, it is inconsistency, missing states, and mobile/accessibility polish. This plan turns "works" into "feels professional."

---

## 0. Audit Summary (current state)

| Area | Backend | UI | Verdict |
|------|---------|-----|---------|
| Home delivery (customer + admin) | ✓ | ✓ full | Polish only |
| User accounts (`/my-jobs`, `/register`, `/login`) | ✓ | ✓ full | Polish + empty/loading states |
| Admin auth (`/login`, `/forgot-password`, `/reset-password`, `/staff/accept-invite`) | ✓ | ✓ full | Unify layout + error UX |
| Admin sub-pages (`/admin/jobs/[id]`, `/admin/jobs/[id]/print`, `/admin/accounts`, `/admin/staff`) | ✓ | ✓ (thin wrappers, full inner components) | Consistent shell + navigation |
| Admin dashboard (`AdminDashboard.tsx`, 1828 lines) | ✓ | ✓ full but dense | Restructure into components, improve scanability |

**Design language today:** pure CSS with custom properties, teal accent `#0d7a74`, system font stack, lucide-react icons, BEM-ish classes, mobile-first customer shell. This is a good foundation — the plan builds on it, no framework migration.

---

## 1. Design System Consolidation (do first — everything else depends on it)

### 1.1 Token file
Create a single source of truth in `globals.css` (or split `tokens.css`):

```css
:root {
  /* Brand */
  --color-primary: #0d7a74;        /* existing teal — keep */
  --color-primary-hover: #0a625d;
  --color-primary-soft: #e6f4f3;   /* tinted backgrounds, badges */
  --color-on-primary: #ffffff;

  /* Semantic */
  --color-success: #15803d;  --color-success-soft: #ecfdf3;
  --color-danger:  #b91c1c;  --color-danger-soft:  #fef2f2;
  --color-info:    #0369a1;  --color-info-soft:    #eff6ff;
  --color-warning: #b45309;  --color-warning-soft: #fffbeb;

  /* Neutral */
  --color-bg: #f4f6f8;  --color-surface: #ffffff;
  --color-ink: #111827; --color-muted: #5a6578; --color-border: #e5e7eb;

  /* Type scale (16px base) */
  --text-xs: 12px; --text-sm: 14px; --text-base: 16px;
  --text-lg: 18px; --text-xl: 22px; --text-2xl: 28px;

  /* Spacing 4pt scale, radius, shadow — keep existing --space-*, --radius-*, --shadow-* but audit for stray hardcoded values */
}
```

**Rule:** no raw hex in components. Sweep all components and replace hardcoded colors with tokens. (Grep shows several inline `rgba(...)` shadows and hex values in `AdminDashboard.tsx` and `UploadForm.tsx`.)

### 1.2 Status color mapping (one table, used everywhere)
| State | Token | Badge style |
|-------|-------|-------------|
| pending / uploaded | info | soft blue bg, blue text |
| approved / printing | primary | soft teal |
| printed / delivered / paid | success | soft green |
| failed / issue | danger | soft red |
| out_for_delivery | warning | soft amber + truck icon |
| expired / cancelled | neutral | gray |

Badges always = icon + text (never color alone — colorblind rule).

### 1.3 Shared primitives (extract, don't rebuild)
Extract from existing markup into small components: `<Badge>`, `<Button variant>`, `<Card>`, `<EmptyState>`, `<Skeleton>`, `<Toast>`, `<ConfirmDialog>`, `<FormField>` (label + input + inline error + helper text). These already exist as repeated CSS patterns — extraction removes drift.

### 1.4 Typography
Keep system font stack (fast, print-shop utility app — editorial fonts wrong fit). Enforce scale: only `--text-*` sizes; weight hierarchy 700 headings / 500 labels / 400 body; tabular-nums on prices, tokens, timers.

---

## 2. Customer Flow (`/` UploadForm) — the money screen

Priority: highest traffic, mobile, on shaky mobile data.

1. **Stepper structure.** The form is one long scroll. Convert to visible 3-step flow: **Upload → Options → Confirm** with a progress indicator, back navigation, and state preserved between steps. Each step fits one phone screen.
2. **Sticky price summary.** Persistent bottom bar: total price (updates live incl. delivery fee), primary CTA. `min-h-dvh` safe-area padding, 44px+ target.
3. **Delivery choice as cards**, not toggle buttons: two selectable cards (Pickup — free, ready in X / Home Delivery — ₹fee, online payment required). Selected card = teal border + check icon. Explain *why* delivery forces online payment inline, before user hits validation error.
4. **Address form:** `autocomplete` attributes (`name`, `tel`, `street-address`), `inputmode="numeric"` for phone, inline validation on blur, error under field with recovery text.
5. **Upload states:** per-file progress with cancel, thumbnail preview, clear error + retry per file (mobile data drops). Skeleton, not spinner, for anything >1s.
6. **Success screen:** token displayed huge (tabular, copyable, tap-to-copy with toast), QR/track link, receipt download, "create account to track orders" soft prompt (links `/register` with jobs auto-linked by phone/email if feasible — future).

## 3. Track + My Jobs (customer retention)

1. **`/track`:** status as vertical timeline (Uploaded → Approved → Printed → Out for delivery → Delivered) with current step highlighted, timestamps, and delivery-vs-pickup branch. Auto-refresh (poll or SSE) with "updated Xs ago".
2. **`/my-jobs`:** job cards with status badge (mapping §1.2), price, date, file count; filter chips (Active / Done); empty state ("No orders yet" + CTA to upload); skeleton list on load; pull-style refresh button. Header shows logged-in identity + logout.
3. **Deep links:** every job card → `/track?token=…`.

## 4. Auth Pages (customer + admin) — unify

All 6 auth screens (`/login` (user), `/admin` (staff), `/register`, `/forgot-password`, `/reset-password`, `/staff/accept-invite`) share one `<AuthShell>`:
- Centered card ≤400px, logo, single h1, one primary CTA.
- Password fields: show/hide toggle, `autocomplete="current-password" / "new-password"`.
- Submit: disabled + spinner during request; error banner with cause + recovery ("Wrong password? Reset it").
- Reset-password: password strength hint (min rules listed as checklist that ticks live).
- Forgot-password success stays generic (no account enumeration) — already correct, keep.
- Focus management: autofocus first field; on error, focus invalid field.
- Clear cross-links: staff login ↔ user login clearly labelled so staff/customers don't land on wrong form.

## 5. Admin Dashboard (`AdminDashboard.tsx`)

1. **Decompose** the 1828-line component: `JobCard`, `JobFilters`, `SummaryBar`, `DeliveryControls`, `PaymentControls`, `BulkActions`. No behavior change — enables everything below.
2. **Layout:** ≥1024px sidebar nav (Queue / Accounts / Staff / Pricing / Analytics) replacing topbar link soup; <1024px keep topbar + menu. Active nav state highlighted.
3. **Job card hierarchy:** token (big, tabular) → customer name/phone → badges row (status, payment, delivery) → actions. Delivery orders show address in collapsible row with tel: link and copy button.
4. **Action safety:** destructive actions (delete, cancel) red + confirm dialog; "Mark delivered" confirm (irreversible-ish); optimistic UI with rollback toast on API failure; every async button gets loading state.
5. **Delivery ops view:** filter preset "Out for delivery" as one-tap chip with count badge; delivery status buttons follow state machine only (never show invalid transition).
6. **Live updates:** SSE already exists — add subtle row highlight animation (200ms fade) when a job updates, `prefers-reduced-motion` respected.
7. **Summary bar:** today's jobs, pending count, unpaid count, revenue — stat tiles at top, tappable = applies filter.

## 6. Admin Sub-pages

- `/admin/jobs/[id]` and `/print`: same admin shell + sidebar as dashboard; breadcrumb (Queue → #TOKEN); consistent back behavior preserving queue filters/scroll (`state-preservation`).
- `/admin/accounts`, `/admin/staff`: adopt shared shell; staff table: role badges, invite modal with inline validation, confirm on delete/demote; empty states.
- Auth-probe pattern (already in wrappers) is good — swap "session expired" text block for the shared `<EmptyState icon=Lock>` and link to `/login` (currently links `/admin`, which loops).

## 7. Cross-cutting Accessibility & Mobile (acceptance criteria for every task above)

- Contrast ≥4.5:1 body, ≥3:1 large/icons — verify teal-on-white combos (current `#0d7a74` on white = ~5.6:1 ✓; check muted `#5a6578` usage on `#f4f6f8`).
- Touch targets ≥44px, spacing ≥8px; `touch-action: manipulation`.
- Visible focus rings everywhere (2px teal offset ring); logical tab order; `aria-live="polite"` for toasts and upload progress; `role="alert"` on form errors.
- Icon-only buttons get `aria-label`; all icons lucide (already true — keep no-emoji rule).
- `min-h-dvh` not `100vh`; test 375px + landscape; no horizontal scroll.
- Animations: 150–300ms, transform/opacity only, `prefers-reduced-motion` media query kills them.
- Skeletons over spinners for >1s loads; reserve space to avoid CLS (image/thumbnail dimensions declared).

## 8. Execution Order

| Phase | Work | Est. scope |
|-------|------|-----------|
| 1 | §1 tokens + primitives extraction (Badge, Button, FormField, EmptyState, Skeleton, ConfirmDialog, AuthShell) | 1–2 sessions |
| 2 | §4 auth unification (mechanical once AuthShell exists) | 1 session |
| 3 | §2 customer upload flow stepper + sticky price + delivery cards | 2 sessions |
| 4 | §3 track timeline + my-jobs polish | 1 session |
| 5 | §5 admin dashboard decompose + layout + safety | 2–3 sessions |
| 6 | §6 sub-pages + §7 final a11y sweep (checklist pass on 375px, dark of contrast, reduced-motion) | 1 session |

Each phase = own branch/worktree, `npm run typecheck` + manual mobile-viewport check before merge. No phase changes API contracts — pure frontend.
