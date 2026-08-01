# Admin Dashboard UI/UX Audit & Improvement Plan

**Scope:** Audit and improvement specification for the Self_Print admin dashboard (`/admin` and all `/admin/*` sub-pages).
**Audience:** Designers and frontend engineers working on the admin surface.
**Status:** Planning / active development

---

## 1. Audit Summary

The admin dashboard is a **hybrid layout**: the main `/admin` page uses a custom `AdminTopbar` + `AdminSidebar` + inline filter row, while every sub-page (`/admin/orders`, `/admin/customers`, `/admin/accounts`, `/admin/staff`, `/admin/security`, `/admin/jobs/[id]`) wraps `AdminManagementNav` — which renders its own topbar + sidebar with a **different** title/nav model. This creates inconsistency in spacing, padding, and navigation behavior across the admin surface.

**Desktop breakpoint:** sidebar reveals at `≥1024px` (grid layout).
**Mobile breakpoint:** drawer sidebar below 1024px. Management pages use `management.css` (imported on `/admin` layout); sub-pages rely on `admin.css` rules.

### Pages audited

| Page | Component | Shell | Key concerns |
|------|-----------|-------|--------------|
| Dashboard | `AdminDashboard.tsx` | `AdminTopbar` + `AdminSidebar` | Dense; dual nav paradigms |
| Orders | `OrderManagementPage.tsx` | `AdminManagementNav` | No sidebar on mobile |
| Customers | `CustomerManagementPage.tsx` | `AdminManagementNav` | Grid→single column on mobile |
| Accounts | `AccountsPage` → `AccountsTab.tsx` | `AdminManagementNav` | 768px / 640px / 480px breakpoints overlap |
| Staff | `StaffPage` → `StaffManagement.tsx` | `AdminManagementNav` | 820px / 560px breakpoints diverge from admin base |
| Security | `SecurityPage.tsx` | `AdminManagementNav` | Table overflow; no mobile card fallback |
| Job Detail | `JobDetail.tsx` | `AdminManagementNav` | `hidden` attribute on tab panels causes re-mount |

---

## 2. Desktop UI Audit (≥1024px)

### 2.1 Layout & Grid Consistency

**Issue:** Two separate navigation paradigms exist on desktop.

- **`AdminDashboard.tsx`** (`admin.css`): Uses a **sticky topbar** (`admin-topbar`) with a **sidebar** (`admin-sidebar`) in a CSS grid: `"sidebar topbar" / "sidebar main"`. The sidebar contains 6 nav links. The topbar holds the printer selector, notifications, refresh, ManageMenu dropdown, pricing, and logout.
- **Sub-pages** (`AdminManagementNav`): Render the sidebar + a **slim topbar** with hamburger + page title + page-specific actions + logout. The `ManageMenu` dropdown is hidden (`#5211`), replaced by the sidebar. But the main dashboard still shows `ManageMenu` as a visible button — **inconsistent**.

**Recommendation:**
- Unify all admin pages to use `AdminManagementNav` shell (sidebar + slim topbar). Move Dashboard-specific controls (printer selector, notifications, pricing) into the topbar or a dashboard-level toolbar, so the shell is one consistent component.
- Remove `ManageMenu` dropdown entirely on desktop — the sidebar already provides navigation. Keep it only for mobile (where the sidebar is a drawer).

### 2.2 Dashboard Structure Density

**Issue:** The dashboard packs filter row, batch bar, job cards, count badge, and keyboard shortcuts hint into a single scrollable column with no visual sectioning. `AdminDashboard.tsx` is 612 lines with no section separators.

**Recommendation:**
- Add subtle section dividers or background bands between filter row → batch bar → job list → footer.
- Break `AdminDashboard.tsx` into sub-components (`JobFilters`, `BatchBar`, `JobList`, `JobsFooter`) per `UI_UX_PLAN.md §5.1`.

### 2.3 Job Card Action Zones

**Issue:** The `JobCard` component implements a **three-zone action row** (status → primary → utility/destructive), but the CSS for responsive behavior has a subtle bug at tablet widths.

```css
/* admin.css:3128 */
.job-actions {
  width: 100%;
  justify-content: flex-start;  /* mobile override */
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
```

At `max-width: 768px`, the `.job-actions` row becomes `width: 100%` with `justify-content: flex-start`, but the three zones (`job-actions-status`, `job-actions-primary`, `job-actions-utility`) remain `display: flex` inline. On a tablet (e.g., 800px), the utility buttons (view, cancel) can wrap awkwardly under the primary buttons, creating a ragged right edge.

**Recommendation:**
- At 768px, stack zones vertically or use `flex: 1` distribution so each zone gets equal width and wraps cleanly.

### 2.4 Pricing & Printer Panels

**Issue:** `PricingPanel` and `PrinterPanel` render as **centered dialogs** (`panel-overlay`) with `max-width: 520px`. On a wide desktop monitor, these float in the center with a dark overlay, but they're **not full-height aware** — the pricing scroll area (`max-height: 60vh`) can feel tight.

**Recommendation:**
- Consider making these **side drawers** or **inline modals** for desktop (slide in from the right, anchored to the topbar), reserving the centered dialog for mobile. This reduces context switch and keeps the user's place in the queue.

### 2.5 Topbar Spacing & Overflow

**Issue:** `admin-topbar-inner` uses `width: min(1200px, calc(100% - 32px))` with `height: 64px`. On a 1024px screen, this leaves ~20px margins. The `printer-btn` label truncates at `max-width: 160px` — printer names longer than that are clipped with no tooltip on the span itself (only on the button).

```css
/* admin.css:285 */
.printer-label {
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```
The `title` attribute is on the parent button, not the label — screen readers may not convey the full name.

**Recommendation:**
- Add `title` to the `.printer-label` span as well, or use `aria-label` on the button that includes the full printer name (already done on the button, but redundant labeling is fine for clarity).

---

## 3. Mobile UI Audit (<1024px)

### 3.1 Mobile Sidebar Drawer

**Issue:** The mobile sidebar drawer renders correctly via `.admin-sidebar.mobile-open`, but **two separate drawer systems coexist**:

- `AdminDashboard.tsx` uses `AdminSidebar` with `open`/`onClose` props (toggled by `sidebarOpen` state, triggered from `AdminTopbar`'s hamburger).
- Sub-pages use `AdminManagementNav` which has its own `mobileOpen` state.

**Problem:** Both drawers have the same max-width (`min(260px, 82vw)`) and animation, but the **overlay** (`sidebar-overlay`) and **close button** (`sidebar-close-btn`) styles differ slightly in the mobile media query. The dashboard's sidebar also has the collapse toggle (`sidebar-collapse-btn`) which is hidden on mobile but rendered — minor dead DOM.

**Recommendation:**
- Consolidate to one `AdminSidebar` usage pattern. The drawer should always include the close button at top-right with safe-area padding (already partially done at `admin.css:5388`).

### 3.2 Topbar Button Overflow at 480px

**Issue:** At `max-width: 480px`, the topbar collapses tightly:

```css
/* admin.css:3157 */
.topbar-actions .action-btn span { display: none; }
.action-btn { width: 40px; height: 40px; }
.printer-btn { flex: 1 1 calc(100% - 56px); }
```

The `printer-btn` gets `flex: 1 1 calc(100% - 56px)` — the `56px` accounts for the hamburger (40px) + gap. But `topbar-actions` is `width: 100%` with `flex-wrap: wrap`. On a 375px screen with the notification badge, refresh, manage, and pricing buttons, there's **no room** — they wrap to a second row, pushing content down. The `printer-btn` then competes for space.

**Recommendation:**
- Consolidate topbar icon buttons into a **single "more actions" overflow menu** (3-dot or hamburger) on screens <480px, keeping only the printer selector and hamburger visible.
- Alternatively, move non-critical actions (pricing, notifications) into the sidebar or a bottom bar.

### 3.3 Job Card Mobile Layout

**Issue:** At `max-width: 480px`:

```css
/* admin.css:3246 */
.job-btn.cancel,
.job-btn.view {
  width: 100%;
}
```

This forces cancel and view buttons to full width, but **does not** apply to `.job-btn.release`, `.job-btn.done`, `.job-btn.paid`, `.job-btn.reprint`. So the primary action buttons remain inline while cancel/view stretch — creating a **misaligned button grid**.

Additionally, at `max-width: 600px` (not 480px), there's a separate rule:

```css
.job-card {
  padding: 14px 10px 14px 6px;
  gap: 8px;
}
```

But the 768px rule sets `padding: 16px` and `flex-wrap: wrap`. The gap between these (600px–768px) is inconsistent.

**Recommendation:**
- At 480px, make **all** `.job-btn` buttons `flex: 1 1 100%` (full width, stacked) rather than selectively stretching cancel/view.
- Remove the 600px padding override and fold it into the 768px rule.

### 3.4 Job Card Checkbox + Action Collision

**Issue:** The `.job-checkbox` is `width: 44px; height: 44px` (meets 44px touch target guideline). But the checkbox circle inside is `26px`, and the checkbox is positioned at the **far left** of the card with `margin-top: 4px`. On mobile, the checkbox and the `job-content` (token, filename) start in the same row — the checkbox can visually collide with the token text on short screens.

**Recommendation:**
- Increase the gap between `.job-checkbox` and `.job-content` to at least `12px` on mobile (currently `14px` gap, but the checkbox sits flush left).

### 3.5 Filter Row Mobile Collapse

**Issue:** The `.admin-filter-row` uses `justify-content: space-between` to push the fulfillment filter to the right. At `max-width: 720px`:

```css
.admin-filter-row {
  flex-direction: column;
  align-items: stretch;
}
.admin-filter-group-end {
  margin-left: 0;
}
```

This stacks status + fulfillment filters vertically. But the `FilterTabs` component and the `delivery-filter-toggle` are in separate groups — when stacked, there's no visual grouping. The "Status" and "Fulfillment" labels sit above each group but the alignment is loose.

**Recommendation:**
- Add a `gap: 12px` and a subtle container border around the filter row at mobile to visually group it.
- Consider merging status + fulfillment into a single segmented control on mobile to reduce vertical space.

### 3.6 Batch Bar Mobile Animation

**Issue:** The `.batch-float-bar` uses `max-height: 0` → `max-height: 80px` transition. At 480px:

```css
.batch-float-bar.visible {
  max-height: 200px;
}
```

But the `.batch-float-inner` content includes **three buttons** (Release, Mark Paid, Delete) + dismiss. On a 375px screen, these wrap but the button text is hidden (`span { display: none }`). Only the icons remain — **no text labels means the buttons are unlabeled icons**, which is an accessibility violation.

**Recommendation:**
- On mobile, replace the floating bar with a **persistent bottom action sheet** (stuck to bottom) that has labeled buttons in a row. Or, keep text labels but allow the bar to be taller (`max-height: 120px`) with buttons on two rows.
- At minimum, add `aria-label` to each button (already has `title`, but ensure `aria-label` is present for screen readers).

### 3.7 Jobs Count + Load More Footer

**Issue:** The `.jobs-count` bar includes load-more button + keyboard shortcut hint. At mobile:

```css
@media (max-width: 640px) {
  .kbd-hint { display: none; }
}
```

The keyboard hint hides, but the `.jobs-count` itself stays at `text-align: center` with `gap: 12px`. On a 375px screen, the text "X of Y jobs" + Load more button are centered, which is fine. But the `Load more` button uses `var(--border)` and `var(--surface)` which are **not defined** in the token set — these may fallback to `rgba(0,0,0,0.02)` or undefined, causing inconsistent rendering.

**Recommendation:**
- Replace `var(--border)` / `var(--surface)` with `var(--line)` / `var(--panel)` (which are defined in the token set).

### 3.8 Management Pages (Orders/Customers) — Toolbar Collapse

**Issue:** `OrderManagementPage` and `CustomerManagementPage` use `.management-toolbar` which is a **2-column grid** (`minmax(260px, 1fr) auto`). At `max-width: 900px`:

```css
.management-toolbar {
  grid-template-columns: 1fr 1fr;
}
.management-toolbar .management-search {
  grid-column: 1 / -1;
}
```

This puts search full-width on top, then filter/select on bottom. But there's **no gap change** — the `gap: 12px` remains. On a 768px tablet, the select dropdown for "stage" can feel cramped.

**Recommendation:**
- At 900px, add `flex-direction: column` with `gap: 12px` explicitly to ensure breathing room.

### 3.9 Customer Management Card Responsive

**Issue:** `.customer-management-grid` is `repeat(2, minmax(0, 1fr))` by default. At `max-width: 900px` → `1fr`, at `max-width: 640px` → padding reduces to `12px`. But the **stats grid** inside each card:

```css
.customer-order-stats {
  grid-template-columns: repeat(4, 1fr);
}
```

Only goes to `repeat(2, 1fr)` at 640px, and `1fr` at 480px. At 480px, four stat labels collapse into a single column — the card becomes very tall.

**Recommendation:**
- At 480px, consider hiding the "Delivered Orders" or "Total spent" stat (less critical) to keep the card scannable, or use a 2×2 grid instead of 1×4.

### 3.10 Staff Page Mobile

**Issue:** `StaffManagement` has breakpoints at `820px` and `560px`, **not matching** the admin base breakpoints (`768px`, `480px`). At 768-820px, the staff summary cards use `grid-template-columns: repeat(3, 1fr)` (3 columns) but the staff member list uses `grid-template-columns: auto 1fr` — the avatar column is too narrow on a tablet.

**Recommendation:**
- Unify breakpoints with the admin base (768px, 480px).
- At 768px, stack staff summary to 2 columns (already done) and member rows to `auto 1fr auto` (avatar + content + actions).

### 3.11 Security Page Table Mobile

**Issue:** The `.security-table` has `min-width: 720px` and is wrapped in `.security-table-wrap` with `overflow-x: auto`. On mobile, it becomes a **horizontal scroll table** with 8 columns. No mobile card fallback exists.

**Recommendation:**
- At `max-width: 768px`, convert the table to a **stacked card layout** where each login event is a card with label/value pairs. This is the standard pattern for auth audit tables on mobile.

### 3.12 Accounts Page Mobile

**Issue:** The `AccountsTab` has its own `@media (max-width: 640px)` block (in `admin.css:3852`) with `acct-cards { grid-template-columns: 1fr 1fr }` and `acct-range-summary { flex-direction: column }`. But the `acct-header` doesn't collapse — the range toggle buttons and export button remain in a horizontal row, which on a 375px screen forces the title to shrink.

**Recommendation:**
- At 480px (not 640px), stack the header controls vertically: title on top, range toggle + export below.
- The `400px` breakpoint for `acct-cards { grid-template-columns: 1fr }` works, but `3853` (640px) and `4926` (unclear width) both target `acct-root` — there are **two overlapping media queries** for accounts that could conflict:

```css
/* Line 3852 */
@media (max-width: 640px) { .acct-cards { grid-template-columns: 1fr 1fr; } }

/* Line 4926 */
@media (max-width: ???) { .acct-root { ... } }
```

Let me verify the second one.

### 3.13 Job Detail Page Mobile Tabs

**Issue:** The `JobDetail.tsx` uses a **tab system** (`mobile-tabs`) that is `display: none` on desktop (`admin.css:2566`) and `display: flex` at `max-width: 900px`. The tabs use `role="tablist"` and `role="tab"` but the panels use `hidden` attribute (`hidden={activeTab !== "details"}`) combined with `display: flex` when active.

**Problem:** Using the `hidden` attribute means the panel's DOM is preserved but not rendered. React may re-mount content (like the PDF iframe) when switching tabs, causing flicker and re-download. Also, the `detail-pane.active` class uses `display: flex` but the `hidden` attribute sets `display: none` — the `display: flex` should override `hidden`, but in practice, the `hidden` attribute is a **presentational hint** that some browsers respect strongly.

**Recommendation:**
- Use `aria-hidden` on inactive panels instead of `hidden`, and control visibility via `display`/`opacity` in CSS. This preserves scroll position and avoids re-mounts.
- Preload the preview image/PDF when the details tab is active to reduce perceived load time.

---

## 4. Accessibility Audit

### 4.1 Focus Management

**Issue:** `ConfirmDialog` is used for cancel/deliver confirmation, but after dismissing, focus is not returned to the triggering button. In `AdminDashboard.tsx`, `setConfirmAction(null)` just removes the dialog — focus stays on the dialog's close (which is gone).

**Recommendation:**
- Trap focus inside `ConfirmDialog` while open, and return focus to the last trigger element on close.

### 4.2 Color Contrast

**Issue:** The `.status-badge` classes use `rgba()` backgrounds with `backdrop-filter: blur`. This can reduce effective contrast on certain displays. Specifically:
- `.status-badge.warn` = `rgba(255, 241, 235, 0.8)` + blue text — check contrast ratio.
- `.status-badge.info` = `rgba(240, 249, 255, 0.8)` + `#0369a1` text — likely fine.

**Recommendation:**
- Audit all badge/background combinations against WCAG 2.1 AA (4.5:1 for body text, 3:1 for large text). The `backdrop-filter: blur` should be removed if it degrades readability.

### 4.3 Icon-Only Buttons

**Issue:** Several icon-only buttons in `JobCard` and `OrderManagementPage` lack `aria-label`:

- `AdminTopbar`'s notification button has `aria-label` ✓
- But `.job-btn.view` in JobCard has `aria-label="Open job details"` ✓
- `.job-btn.cancel` in JobCard has `aria-label="Cancel job"` ✓
- `.batch-float-dismiss` has `aria-label="Clear selection"` ✓
- `printer-check` in PrinterPanel has no `aria-label`

**Recommendation:**
- Audit all icon-only buttons for `aria-label` coverage. The `printer-check` is decorative (it shows the checkmark for the selected printer), so `aria-hidden` is sufficient.

### 4.4 Screen Reader Announcements

**Issue:** The SSE notification system increments `unseen` count and plays a chime, but there's **no `aria-live` announcement** for new jobs arriving. The `notif-badge` updates visually but screen reader users won't know a new job arrived unless they notice the chime.

**Recommendation:**
- Add an `aria-live="polite"` region that announces "New order #XXXX arrived" when `data.type === "new_job"`.

---

## 5. Mobile-Specific Recommendations Summary

| Issue # | Component | Fix |
|---------|-----------|-----|
| 5.1 | All `.job-btn` at 480px | Make ALL action buttons full-width stacked, not just cancel/view |
| 5.2 | Topbar at 480px | Collapse icon buttons into a "more" overflow menu |
| 5.3 | `.jobs-count` | Replace undefined CSS vars `--border`/`--surface` with `--line`/`--panel` |
| 5.4 | Batch float bar at 480px | Add `aria-label` to icon-only buttons; consider bottom action sheet |
| 5.5 | Filter row at 720px | Add container styling to group filters |
| 5.6 | Customer stats at 480px | Collapse to 2×2 grid, not 1×4 |
| 5.7 | Security table at 768px | Convert to stacked cards |
| 5.8 | Staff page breakpoints | Unify with admin base (768px, 480px) |
| 5.9 | Account header at 480px | Stack controls vertically |
| 5.10 | Job detail tabs | Use `aria-hidden` instead of `hidden` to preserve state |

---

## 6. Desktop-Specific Recommendations Summary

| Issue # | Component | Fix |
|---------|-----------|-----|
| 6.1 | Dashboard vs sub-page nav | Unify to `AdminManagementNav` shell; move dashboard controls into topbar |
| 6.2 | `AdminDashboard.tsx` density | Section dividers; decompose into sub-components |
| 6.3 | Job card action zones at 768px | Distribute zones evenly (`flex: 1`) instead of `flex-start` |
| 6.4 | Pricing/Printer panels | Consider side drawer on desktop |
| 6.5 | `.printer-label` | Add `aria-label`/tooltip for truncated names |
| 6.6 | `.admin-shell` padding | At 600px, `width: calc(100% - 12px)` — verify this doesn't clip the sidebar on collapse |

---

## 7. Component-Level Issues

### 7.1 `AdminDashboard.tsx` (612 lines)

- **612 lines** is too dense. Should be decomposed.
- `jobAction()` has a 6-branch endpoint routing — consider a map object.
- `batchPaid()` does sequential `Promise.all` — fine for correctness, but if one fails, none roll back (partial success).
- `loadMore()` doesn't handle auth expiry (200 vs 401).
- Keyboard shortcuts (`1`–`6`) map to filter keys but the labels are "Queued", "Unpaid", etc. — not documented visually. The `kbd-hint` shows below the jobs count but only on desktop (hidden at `≤640px`).

### 7.2 `JobCard.tsx` (286 lines)

- Uses component-local state (`printMode`, `printing`, `flash`) — not hydratable on server. Fine for client component.
- The `print-mode-group` (Auto/Manual toggle) appears inline next to the Release button. On desktop, this adds horizontal width pressure in the action zone.
- The **payment strip** (`job-pay-row`) is below the action row — good visual hierarchy, but the "Mark as Paid" button is the same visual weight as other `.job-btn` — could use more prominence (payment is a primary workflow step).

### 7.3 `OrderManagementPage.tsx`

- The "Dispatch" button (`order-action primary`) and "Mark delivered" button (`order-action success`) — the distinction between primary (teal) and success (green) is subtle. Consider using the same color (teal) for both, with success being a "confirmation" state, not a different action type.
- No **bulk action** support (unlike the dashboard's BatchBar). If the order management page is where dispatch happens, bulk dispatch would be valuable for delivery riders.

### 7.4 `CustomerManagementPage.tsx`

- The export button uses inline `style={{ display: "flex", gap: "8px", alignItems: "center" }}` — should be a CSS class for consistency and maintainability.
- The "View orders" link in each customer card footer filters by phone/email — but the `OrderManagementPage` reads `customer` from `URLSearchParams` on mount only. If the customer has no phone (guest), the link uses email or displayName — this works but the filter logic in `OrderManagementPage` matches `job.customerPhone` which may be null for guest delivery orders entered manually.

### 7.5 `StaffManagement.tsx`

- The "Create account" form uses `type="text"` for password (line 429) instead of `type="password"`. This shows the password in plaintext during entry — **accessibility concern** but also a security/privacy issue on a shared shop PC.
- The `staff-role-help` text appears below both invite and create forms but only updates for the active tab — minor.
- No **confirmation dialog** before removing a staff member — uses inline confirm (Cancel/Remove buttons). This is acceptable but the confirm row appears inline in the list, pushing other items down. A modal overlay would be less disruptive.

### 7.6 `SecurityPage.tsx`

- The table has 8 columns (`Staff`, `Date/Time`, `IP`, `Browser`, `OS`, `Device`, `Location`, `Status`). On a 1024px screen, this is cramped. No column hiding logic for near-mobile widths.
- The `SignOutOthersCard` is outside the `.management-workspace` section — visually inconsistent with the table below it.

---

## 8. Performance & Interaction Notes

### 8.1 SSE Connection

- The dashboard connects to SSE on mount (no cleanup dependency on auth). If the user's session expires, the SSE stream returns 401 but `connectSSE` retries every 5s indefinitely, flooding the server with reconnect attempts.
- `onmessage` calls `mutateJobs()` (full revalidation) for `new_job` — this re-fetches the entire job list on every new job, not just appends.

**Recommendation:**
- Add a backoff to SSE reconnection (exponential, max 30s).
- For `new_job`, prepend to the list instead of full revalidation.

### 8.2 Job Card Animation Cascade

- `.job-list .job-card:nth-child(n)` has hardcoded delays up to 8 cards. After 8, all remaining cards animate simultaneously — feels like a loading bug.
- `prefers-reduced-motion` is **not checked** anywhere. The `flash` animation (900ms) on status change violates the motion preference.

**Recommendation:**
- Remove the `nth-child` stagger for >8 cards, or use a CSS `:where` selector.
- Wrap all animations in `@media (prefers-reduced-motion: no-preference)`.

### 8.3 Back Navigation State Preservation

- `JobDetail`'s back link goes to `/admin` but does **not** preserve the current filter/sort state. If the user was viewing "Approved" jobs, going back resets to "All".
- `OrderManagementPage` has the same issue when navigating from a customer's order list back to the main orders page.

**Recommendation:**
- Use `useRouter` with `state` to preserve filter context, or use `URLSearchParams` for filter state so it survives a soft nav.

---

## 9. Implementation Priority

| Priority | Task | Files Involved | Status |
|----------|------|----------------|--------|
| **P1** | Fix `.job-btn` responsive stacking (5.1) | `admin.css:3246` | ✅ Done |
| **P1** | Replace undefined CSS vars `--border`/`--surface` (5.3) | `admin.css:2346-2347` | ✅ Done |
| **P1** | Fix password `type="text"` in StaffManagement (7.5) | `StaffManagement.tsx:429` | ✅ Done |
| **P1** | Add `prefers-reduced-motion` to all animations (8.3) | `admin.css` global sweep | ✅ Done |
| **P1** | Unify breakpoints (staff page 820px/560px) (5.8) | `admin.css`, `StaffManagement` CSS | ✅ Done |
| **P2** | Convert Security table to cards on mobile (5.7) | `SecurityPage.tsx`, `management.css` | ✅ Done |
| **P2** | Fix Job Detail tab `hidden` → `aria-hidden` (5.10) | `JobDetail.tsx`, `admin.css:2566` | ✅ Done |
| **P2** | Consolidate topbar buttons at 480px (5.2) | `admin.css:3157` | ⬜ Not started — needs its own plan (new overflow-menu component) |
| **P2** | Unify dashboard/sub-page navigation shell (6.1) | `AdminDashboard.tsx`, `AdminManagementNav.tsx` | ⬜ Not started — large structural refactor, needs its own plan |
| **P3** | Add bulk dispatch to OrderManagementPage | `OrderManagementPage.tsx` | ⬜ Not started — new feature, needs brainstorming pass |
| **P3** | Replace inline styles in CustomerManagementPage (7.4) | `CustomerManagementPage.tsx` | ✅ Done |
| **P3** | SSE backoff + append-only new jobs (8.1) | `AdminDashboard.tsx:125` | ◐ Backoff done; append-only skipped — `broadcast()` in `jobs/route.ts` only sends `jobId`/`token`, not full job, so it still full-revalidates |
| **P3** | State preservation on back navigation (8.3) | `JobDetail.tsx`, `OrderManagementPage.tsx` | ⬜ Not started |

---

## 10. Design System Gaps

| Gap | Current | Recommendation |
|-----|---------|----------------|
| **Breakpoints** | 320px, 360px, 400px, 480px, 560px, 600px, 640px, 720px, 768px, 820px, 900px, 1024px | Standardize to 480 / 768 / 1024 / 1280 |
| **Touch targets** | Mostly 44px, but `.print-mode-opt` is 26px min-height | Enforce 44px globally via `pointer: coarse` |
| **Focus rings** | Some elements lack visible focus (e.g., `.filter-tab:active` scales but no focus ring) | Add `outline: 2px solid var(--accent); outline-offset: 2px;` to all interactive elements |
| **Typography scale** | `font-size` scattered: 10px–22px, no consistent scale | Map to `--text-xs` (12) / `--text-sm` (14) / `--text-base` (16) / `--text-lg` (18) / `--text-xl` (20) / `--text-2xl` (24) |
| **Color tokens** | `--accent`, `--danger`, `--ok`, `--warn`, `--info` defined but `--border`, `--surface`, `--text`, `--background` are **not** consistently used or defined | Audit all `globals.css` for defined custom properties and create a token reference |

---

*End of audit. Next step: implement P1 fixes and re-audit at 375px / 768px / 1024px viewports.*
