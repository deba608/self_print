# SelfPrint email templates

Paste each `.html` file below into Supabase Dashboard → Authentication → Emails → Templates → (matching template) → Source. Subject lines listed too.

Requires custom SMTP already configured (Project Settings → Auth → SMTP Settings) — default Supabase mailer is rate-limited and these won't send reliably without it.

| File | Supabase template | Suggested subject |
|---|---|---|
| confirm-signup.html | Confirm signup | Confirm your SelfPrint account |
| reset-password.html | Reset password | Reset your SelfPrint password |
| magic-link.html | Magic Link | Your SelfPrint sign-in link |
| change-email.html | Change Email Address | Confirm your new email |
| invite-staff.html | Invite user | You've been invited to SelfPrint |
| reauthentication.html | Reauthentication | Confirm it's you |

Variables used come from Supabase's template syntax (`{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .SiteURL }}`, `{{ .Email }}`) — don't rename them, Supabase substitutes at send time.
