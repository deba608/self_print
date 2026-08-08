# Customization Note & Contact Feature Plan

## Overview
Add a way for customers to attach a custom note to their print job **or** provide a contact method (WhatsApp number / phone) for follow‑up on special customizations. The shop staff will not call the customer; instead, the customer should call +91 87630 52472 for any customizations. Extend the pricing logic to support flexible, non‑fixed customization fees.

## UI Changes
1. **Upload Form (`/app/page.tsx` or component)**
   - Add a textarea **“Additional instructions / note”** (max 250 chars).
- Add a radio/checkbox **“I’d like a staff member to contact me for customizations”**. This option does **not** require any input; the system will display the static contact number **+91 87630 52472** (WhatsApp and phone) for the customer to call.
2. **Admin Dashboard (`/admin/...`)**
   - Display the note and contact info in the job detail view.
   - Highlight jobs that requested contact.

## Backend Changes
1. **Database schema** (`src/lib/db.ts` or migration)
   - Add columns to `jobs` table: `custom_note TEXT`, `contact_whatsapp TEXT`, `contact_phone TEXT`.
   - Add nullable fields; default `NULL`.
2. **API route** (`src/app/api/jobs/…`)
   - Accept the new fields in the upload handler, store them via DB helper.
3. **Type definitions** (`src/lib/types.ts`)
   - Extend `Job` interface with the new optional properties.

## Pricing Logic
1. Add a **“customization surcharge”** configurable via the existing pricing config (`pricing_config` table).
2. UI: Show a checkbox **“Add customizations (additional $X)”** that, when checked, adds the surcharge to the total price.
3. Update `src/lib/pricing.ts` to compute the surcharge when `custom_note` or contact flag is present.

## Implementation Steps
| Step | Description | Files Affected | Owner |
|------|-------------|----------------|-------|
| 1 | Design UI mockup and add note/contact fields | `components/UploadForm.tsx` (or page) | Front‑end |
| 2 | Extend DB schema and run migration | `src/lib/db.ts`, new migration script | Backend |
| 3 | Update type definitions | `src/lib/types.ts` | Backend |
| 4 | Modify upload API to persist new fields | `src/app/api/jobs/[id]/route.ts` | Backend |
| 5 | Add pricing surcharge config & calculation | `src/lib/pricing.ts`, admin pricing UI | Backend |
| 6 | Show note/contact info in admin UI | `app/admin/jobs/[id]/page.tsx` | Front‑end |
| 7 | Write unit / integration tests for new fields | `tests/...` | QA |
| 8 | Update documentation & release notes | `docs/customization-plan.md`, `CHANGELOG.md` | Docs |

## Testing
- **Unit tests** for DB helper saving/retrieving new fields.
- **Integration test**: upload a job with a note and contact info, verify API response and admin view.
- **Pricing test**: ensure surcharge appears correctly when note/contact is present.

## Deployment
1. Run migration to add columns.
2. Deploy updated front‑end and back‑end.
3. Verify in staging that jobs with notes appear correctly and pricing is updated.

## Open Questions
- Should the contact fields be optional if the note is provided?
- What default surcharge amount is appropriate? (Configurable via admin UI.)
- Do we need GDPR / privacy notice for storing personal phone numbers?

---
*Prepared based on the current Self_Print codebase and conventions.*