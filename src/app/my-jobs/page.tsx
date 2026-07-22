import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ShopHeader from "@/components/ShopHeader";

const statusMap: Record<string, { label: string; class: string }> = {
  pending_payment: { label: "Queued", class: "warn" },
  paid: { label: "Queued", class: "warn" }, // legacy rows from before payment was decoupled
  approved: { label: "Ready", class: "ready" },
  printing: { label: "Printing", class: "info" },
  printed: { label: "Done", class: "ok" },
  failed: { label: "Failed", class: "danger" },
  cancelled: { label: "Cancelled", class: "danger" },
};

function formatRupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function MyJobsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/customer-login");
  }

  // Defense-in-depth alongside RLS's "customers can view own jobs" policy.
  const { data, error } = await supabase
    .from("jobs")
    .select("id, token, status, print_type, copies, page_count, price_paise, created_at, paid_at, printed_at")
    .eq("customer_user_id", user.id)
    .order("created_at", { ascending: false });

  const jobs = error ? [] : data ?? [];

  return (
    <main className="customer-shell">
      <ShopHeader />
      <section className="panel stack">
        <div className="intro">
          <h1>My Jobs</h1>
          <p className="muted">Everything you&apos;ve printed with this account.</p>
        </div>

        {error && <div className="error-msg" role="alert">Could not load your jobs. Try again.</div>}

        {!error && jobs.length === 0 && (
          <p className="muted" style={{ textAlign: "center" }}>
            No jobs yet. <Link href="/">Upload a file</Link> to get started.
          </p>
        )}

        {jobs.length > 0 && (
          <div className="job-list">
            {jobs.map((job) => {
              const status = statusMap[job.status] || { label: job.status, class: "" };
              return (
                <Link
                  key={job.id}
                  href={`/track?token=${job.token}`}
                  className={`job-card ${job.status}`}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="job-side" style={{ flex: 1 }}>
                    <div>
                      <strong className="token-value">{job.token}</strong>
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {formatDate(String(job.created_at))}
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: "0.85em" }}>
                      {job.print_type === "color" ? "Color" : "B&W"} &middot; {job.copies}{" "}
                      {job.copies === 1 ? "copy" : "copies"} &middot; {job.page_count}{" "}
                      {job.page_count === 1 ? "page" : "pages"}
                    </div>
                  </div>
                  <div className="job-actions">
                    <span className={`status-badge ${status.class}`}>{status.label}</span>
                    <span className="result-meta-value">{formatRupees(Number(job.price_paise))}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
