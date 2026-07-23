# User Dashboard Navbar — Plan

## Problem
Current user dashboard (`/my-jobs`, `/track`) uses `ShopHeader` + a separate account bar. Navigation and user info are split across two components, causing visual clutter and inconsistent UX.

## Goals
- Single cohesive navbar for authenticated user pages
- Clear active-page indication
- User identity + logout integrated into the nav, not a separate bar
- Mobile-friendly (bottom nav or hamburger)
- Reuse existing design tokens (`--accent`, `--panel`, `--radius-full`, etc.)

## Pages covered

| Page | Route | Nav label | Icon |
|------|-------|-----------|------|
| New Print | `/` | New Print | `Upload` |
| My Jobs | `/my-jobs` | My Jobs | `PackageSearch` |
| Track Order | `/track` | Track | `Search` |

## Layout (desktop)

```
┌─────────────────────────────────────────────────────┐
│  🖨 Self_Print    [New Print] [My Jobs] [Track]    user@email.com [Logout] │
└─────────────────────────────────────────────────────┘
```

Logo left → center nav pills → right user cluster (email + avatar fallback + logout).

## Layout (mobile <600px)

Bottom tab bar with 3 nav items + user section in a collapsible drawer (or keep a slim top bar with hamburger).

**Recommended approach:** Bottom tab bar on mobile (thumb-reachable), top bar on desktop.

## Behavior & states

- **Active tab:** teal pill (matching `.shop-nav-tab.active` style)
- **Loading state:** skeleton placeholder for user email while auth resolves
- **Signed out:** redirects to `/login` (my-jobs already does this server-side)
- **Logout:** server action via form (existing pattern in my-jobs)

## Implementation

1. Create `src/components/UserNavbar.tsx` — client component, uses `usePathname` for active state, fetches user via supabase client
2. Update `src/app/my-jobs/page.tsx` — replace `ShopHeader` + account bar with `UserNavbar`
3. Update `src/app/track/page.tsx` — replace `ShopHeader` with `UserNavbar`
4. CSS: reuse existing `.shop-*` classes; add minimal overrides in globals.css if needed

## Out of scope
- Guest users (still use `ShopHeader`)
- Admin pages (have their own shell)
- `/register`, `/login`, `/forgot-password` (use `AuthShell`)
