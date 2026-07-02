# Self_Print — Future Feature Ideas

Backlog of improvements. Ranked by value-for-effort. Pick when ready.

## High value, low effort

### 1. Customer status page — `/status/[token]`
Customer enters/scans token, sees live status: queue position, paid?, printing?, done.
Eliminates "is it ready yet?" questions at counter.
- Reuse: existing SSE + job status
- Read-only page, ~1 session

### 2. "I've Paid" button + UTR entry
After UPI pay, customer taps "I've Paid" and enters last 4 digits of UPI reference.
Staff matches against bank notification → faster verify, fewer disputes than reading screenshots.
- Adds: small field on result screen + admin display
- DB: optional `payment_ref` column on `jobs`

### 3. Auto-delete files after print
Delete file bytes immediately when job hits `printed` status. Keep job row for records.
Privacy + storage cost win.
- Reuse: existing cleanup logic
- Change: trigger delete on status transition, not just expiry

## High value, medium effort

### 4. WhatsApp / SMS notification
"Token 482 ready, ₹12. Collect at counter."
- Free option: `wa.me` click-to-send link for staff
- Paid option: SMS gateway (Twilio/MSG91) for auto-send
- Big UX win — customer leaves, returns when pinged

### 5. Revenue dashboard (admin)
Today / week / month totals, job count, B&W vs color split, busiest hours.
- Reuse: `jobs.price_paise` + `print_events` aggregation
- New admin tab with summary queries

### 6. Multi-file single job
Upload multiple files → one token, one combined payment.
Common print-shop need.
- `job_files` already supports multiple rows per job
- Needs: multi-upload UI + summed pricing

## Medium value, higher effort

### 7. Auto payment confirmation (payment gateway)
Razorpay / Cashfree webhook → auto-mark job paid, no manual verify.
- Trade-off: ~2% fees + setup/KYC
- Only worth it at higher volume
- Removes manual UPI verification entirely

## Smaller polish ideas
- Estimated wait time on result screen (queue position × avg print time)
- Reprint button in admin (re-queue a finished job)
- Printer out-of-paper / offline alert from agent
- Rate limiting on upload endpoint (abuse prevention)
- File preview thumbnail in admin queue
- Configurable shop hours / "closed" banner on customer page

---
*Recommended first: #1 (status page) + #3 (auto-delete) — biggest customer + privacy win, both reuse existing code.*
