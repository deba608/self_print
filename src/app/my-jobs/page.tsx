import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import {
  Clock,
  CircleCheck,
  Printer,
  CircleX,
  Truck,
  PackageCheck,
  Inbox,
  UploadCloud,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import UserNavbar from "@/components/UserNavbar";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";

// Status → badge mapping per docs/UI_UX_PLAN.md §1.2 — icon + text, never color alone.
const statusMap: Record<string, { label: string; variant: BadgeVariant; icon: LucideIcon }> = {
  pending_payment: { label: "Queued", variant: "info", icon: Clock },
  paid: { label: "Queued", variant: "info", icon: Clock }, // legacy rows from before payment was decoupled
  approved: { label: "Ready", variant: "primary", icon: CircleCheck },
  printing: { label: "Printing", variant: "primary", icon: Printer },
  printed: { label: "Done", variant: "success", icon: CircleCheck },
  failed: { label: "Failed", variant: "danger", icon: CircleX },
  cancelled: { label: "Cancelled", variant: "neutral", icon: CircleX },
  expired: { label: "Expired", variant: "neutral", icon: Clock },
};

const DONE_STATUSES = ["printed", "failed", "cancelled", "expired"];

type Filter = "all" | "active" | "done";

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

function JobListSkeleton() {
  return (
    <div className="job-list" aria-busy="true" aria-label="Loading your orders">
      {[0, 1, 2].map((i) => (
        <div key={i} className="job-card jobs-skeleton-card">
          <div className="jobs-skeleton-lines">
            <Skeleton width="40%" height={18} />
            <Skeleton width="65%" height={13} />
          </div>
          <Skeleton width={72} height={24} style={{ borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}

async function JobsList({ filter }: { filter: Filter }) {
  // Any failure (e.g. Supabase env not configured in pure-SQLite local dev)
  // is treated the same as an unauthenticated visitor: redirect to login
  // instead of letting the page 500.
  let user = null;
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch {
    user = null;
    supabase = null;
  }

  if (!user || !supabase) {
    redirect("/login");
  }

  // Defense-in-depth alongside RLS's "customers can view own jobs" policy.
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, token, status, print_type, copies, page_count, price_paise, created_at, paid_at, printed_at, delivery_method, delivery_status"
    )
    .eq("customer_user_id", user.id)
    .order("created_at", { ascending: false });

  const allJobs = error ? [] : data ?? [];
  const jobs = allJobs.filter((job) => {
    if (filter === "active") return !DONE_STATUSES.includes(job.status);
    if (filter === "done") return DONE_STATUSES.includes(job.status);
    return true;
  });

  return (
    <>
      <nav className="jobs-filter-chips" aria-label="Filter orders">
        {(
          [
            ["all", "All"],
            ["active", "Active"],
            ["done", "Done"],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <Link
            key={key}
            href={key === "all" ? "/my-jobs" : `/my-jobs?filter=${key}`}
            className={`jobs-filter-chip ${filter === key ? "is-active" : ""}`}
            aria-current={filter === key ? "true" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>

      {error && (
        <div className="error-msg" role="alert">
          Could not load your jobs. Try again.
        </div>
      )}

      {!error && jobs.length === 0 && (
        <EmptyState
          icon={Inbox}
          title={filter === "all" ? "No orders yet" : `No ${filter} orders`}
          description={
            filter === "all"
              ? "Upload a file to get your first print token."
              : "Orders will show up here as their status changes."
          }
          action={
            filter === "all" ? (
              <Link href="/" className="btn-primary jobs-empty-cta">
                <UploadCloud size={16} aria-hidden="true" /> Upload a file
              </Link>
            ) : undefined
          }
        />
      )}

      {jobs.length > 0 && (
        <div className="job-list">
          {jobs.map((job) => {
            const status = statusMap[job.status] || {
              label: job.status,
              variant: "neutral" as BadgeVariant,
              icon: Clock,
            };
            const isDelivery = job.delivery_method === "delivery";
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
                <div className="job-actions jobs-card-badges">
                  <Badge variant={status.variant} icon={status.icon}>
                    {status.label}
                  </Badge>
                  {isDelivery &&
                    (job.delivery_status === "delivered" ? (
                      <Badge variant="success" icon={PackageCheck}>
                        Delivered
                      </Badge>
                    ) : job.delivery_status === "out_for_delivery" ? (
                      <Badge variant="warning" icon={Truck}>
                        Out for delivery
                      </Badge>
                    ) : (
                      <Badge variant="neutral" icon={Truck}>
                        Delivery
                      </Badge>
                    ))}
                  <span className="result-meta-value jobs-price">
                    {formatRupees(Number(job.price_paise))}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

export default async function MyJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter: Filter =
    params.filter === "active" || params.filter === "done" ? params.filter : "all";

  return (
    <main className="customer-shell">
      <UserNavbar />
      <section className="panel stack">
        <div className="intro">
          <h1>My Jobs</h1>
          <p className="muted">Everything you&apos;ve printed with this account.</p>
        </div>
        <Suspense key={filter} fallback={<JobListSkeleton />}>
          <JobsList filter={filter} />
        </Suspense>
      </section>
    </main>
  );
}
