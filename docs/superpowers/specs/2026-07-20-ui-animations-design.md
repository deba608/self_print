# UI Animation Enhancements — Design

Date: 2026-07-20

## Goal
Add feedback-focused animations across customer upload flow and admin dashboard. Pure CSS + minimal React state; no animation libraries. All motion respects `prefers-reduced-motion` (already globally handled in globals.css).

## Scope

### Customer (`UploadForm.tsx` + `globals.css`)
1. **Upload progress shimmer** — moving highlight sweep on `.upload-progress-fill` while uploading.
2. **Drag-over dropzone state** — `.upload-zone.drag-over`: accent border, scale-up, icon bounce. Drop files handled same as picker selection.
3. **Success check draw** — replace static lucide Check on token screen with inline SVG whose stroke draws in (`stroke-dashoffset` animation).
4. **Price pop** — `.price-value` re-keyed on estimate change; quick scale/color pop so cause-and-effect of settings changes is visible.
5. **Bulk file row entrance** — rows fade+slide in when added.
6. **Queue number pulse** — gentle looping pulse on queue position on the token screen.

### Admin (`AdminDashboard.tsx` + `globals.css`)
7. **Job card entrance** — already staggered via `animationDelay`; kept.
8. **Status change flash** — JobCard watches `job.status`; on change adds a `.flash` class for ~900ms (background highlight fade, badge scale-bounce).
9. **Skeleton loaders** — shimmer skeleton cards shown until first `/api/admin/jobs` load resolves (new `jobsLoaded` state).
10. **Toast notifications** — dashboard-level toast stack (slide in from bottom-right, auto-dismiss 3.5s). Job actions push success toasts; manual-print error `alert()` replaced with error toast. `actionError` banner kept for persistent errors.

## Non-goals
- Animation libraries (auto-animate etc.).

## Error handling
Toasts are purely presentational; failures still surface via existing `actionError` path.

## Testing
`npm run typecheck` + `npm run build`; visual verification in dev preview.

## Progress

All 10 items implemented and wired (CSS in `globals.css`, markup/state in `UploadForm.tsx` / `AdminDashboard.tsx`). `npm run typecheck` passes.

Customer:
1. Upload progress shimmer — done (`.upload-progress-fill::after`, `shimmer` keyframes)
2. Drag-over dropzone — done (`dragOver` state, `onDragOver`/`onDrop`, `.upload-zone.drag-over`)
3. Success check draw — done (`.check-draw` polyline, stroke-dashoffset animation)
4. Price pop — done (`key={estimate}` re-mount + `.price-pop`)
5. Bulk file row entrance — done (`.bulk-file-row` fadeInUp)
6. Queue number pulse — done (`.queue-pulse` on result screen)

Admin:
7. Job card entrance — done (pre-existing `animationDelay` stagger, kept)
8. Status change flash — done (`flash` state on `JobCard`, `.job-card.flash`)
9. Skeleton loaders — done (`jobsLoaded` state, `.job-skeleton` cards)
10. Toast notifications — done (`pushToast`, `.toast-stack`, old `alert()` removed)

Follow-up round — row exit + hover-lift (was Non-goal, revisited):
11. **Row exit collapse (ManageOrdersPanel)** — done. `leavingIds` set marks deleted job(s) leaving; `.manage-order-item.leaving` collapses max-height/opacity/padding/border to 0 over 260ms before `onRefresh()` actually drops the row (single delete + bulk delete both wired).
12. **Bulk-file-row exit** — done. Row keyed by stable `bulkIds[i]` (was index); ✕ click marks id leaving, `.bulk-file-row.leaving` collapses via CSS transition, real array splice fires on `onTransitionEnd` (id-based lookup, not stale index — safe under rapid multi-remove).
13. **Job-card hover-lift** — was already implemented (`.job-card:hover` had `translateY(-1px)` + shadow); confirmed, no change needed.

`npm run build` run: compiles + typechecks clean. One pre-existing `PageNotFoundError: /_document` during page-data collection, unrelated to these changes (App Router project, no `pages/` dir).

Remaining: visual dev-preview pass not yet done this session.
