import Link from "next/link";
import { UserRound, PackageSearch, ArrowRight } from "lucide-react";
import UploadForm from "@/components/UploadForm";
import ShopHeader from "@/components/ShopHeader";
import { createClient } from "@/lib/supabase/server";

export default async function CustomerPage() {
  // Any failure (e.g. Supabase env not configured in pure-SQLite local dev)
  // is swallowed and treated as a guest, so the homepage still renders.
  let user = null;
  try {
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch {
    user = null;
  }

  return (
    <main className="customer-shell">
      <ShopHeader />
      <section className="panel stack">
        <div className="intro">
          <h1>Print Your Files</h1>
          <p className="muted">Upload from your phone, get a token, pay at the counter, and collect your print.</p>
        </div>

        {user ? (
          <Link href="/my-jobs" className="account-strip" aria-label="View my jobs">
            <span className="account-strip-icon">
              <PackageSearch size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="account-strip-text">
              <strong>My Jobs</strong>
              <span>{user.email}</span>
            </span>
            <ArrowRight size={16} className="account-strip-arrow" aria-hidden="true" />
          </Link>
        ) : (
          <div className="account-strip">
            <span className="account-strip-icon">
              <UserRound size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="account-strip-text">
              <strong>Track your orders anytime</strong>
              <span>Log in or create a free account</span>
            </span>
            <span className="account-strip-actions">
              <Link href="/customer-login" className="account-strip-btn">Log in</Link>
              <Link href="/register" className="account-strip-btn ghost">Sign up</Link>
            </span>
          </div>
        )}

        <UploadForm />
      </section>
    </main>
  );
}