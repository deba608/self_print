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
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
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
          <Skeleton width={72} height={24} style={{ borderRadius: 6 }} />
        </div>
      ))}
    </div>
  );
}

// Page size for the first load; "Show more" links re-render the server
// component with a larger limit. Keeps the query and the DOM bounded for
// heavy users instead of fetching every job they ever printed.
const PAGE_SIZE = 30;
const MAX_LIMIT = 300;

async function JobsList({ filter, limit }: { filter: Filter; limit: number }) {
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
  // Filter server-side and fetch limit+1 rows so we know whether to render
  // "Show more" without a separate count query.
  let query = supabase
    .from("jobs")
    .select(
      "id, token, status, print_type, copies, page_count, price_paise, created_at, paid_at, printed_at, delivery_method, delivery_status"
    )
    .eq("customer_user_id", user.id);
  if (filter === "done") {
    query = query.in("status", DONE_STATUSES);
  } else if (filter === "active") {
    query = query.not("status", "in", `(${DONE_STATUSES.join(",")})`);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  const fetched = error ? [] : data ?? [];
  const hasMore = fetched.length > limit;
  const jobs = hasMore ? fetched.slice(0, limit) : fetched;

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
              <Link href="/" className="jobs-empty-cta">
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
                className={`job-card jobs-list-card ${job.status}`}
              >
                <div className="jobs-card-main">
                  <div className="jobs-card-header">
                    <strong className="token-value">#{job.token}</strong>
                    <span className="muted jobs-card-date">
                      {formatDate(String(job.created_at))}
                    </span>
                    <ChevronRight className="jobs-card-arrow" size={18} aria-hidden="true" />
                  </div>
                  <div className="muted jobs-card-specs">
                    {job.print_type === "color" ? "Color" : "B&W"} &middot; {job.copies}{" "}
                    {job.copies === 1 ? "copy" : "copies"} &middot; {job.page_count}{" "}
                    {job.page_count === 1 ? "page" : "pages"}
                  </div>
                </div>
                <div className="jobs-card-footer">
                  <div className="jobs-card-badges">
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
                  </div>
                  <span className="result-meta-value jobs-price">
                    {formatRupees(Number(job.price_paise))}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {hasMore && limit < MAX_LIMIT && (
        <Link
          href={`/my-jobs?filter=${filter}&limit=${Math.min(limit + PAGE_SIZE, MAX_LIMIT)}`}
          className="jobs-filter-chip jobs-load-more"
        >
          Show more
        </Link>
      )}
    </>
  );
}

export default async function MyJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const filter: Filter =
    params.filter === "active" || params.filter === "done" ? params.filter : "all";
  const parsedLimit = Number.parseInt(params.limit ?? "", 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, PAGE_SIZE), MAX_LIMIT)
    : PAGE_SIZE;

  return (
    <main className="customer-shell">
      <section className="panel stack jobs-page">
        <div className="intro">
          <h1>My Jobs</h1>
          <p className="muted">Everything you&apos;ve printed with this account.</p>
        </div>
        <Suspense key={`${filter}-${limit}`} fallback={<JobListSkeleton />}>
          <JobsList filter={filter} limit={limit} />
        </Suspense>
      </section>
    </main>
  );
}
