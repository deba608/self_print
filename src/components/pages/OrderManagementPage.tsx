"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  MapPinned,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  Truck,
  WalletCards,
} from "lucide-react";
import AdminManagementNav from "../AdminManagementNav";
import ManagementSkeleton from "../ui/ManagementSkeleton";
import { useJobs } from "@/hooks/useAdmin";
import type { Job } from "@/lib/types";

type FulfilmentFilter = "all" | "pickup" | "delivery";
type StageFilter = "all" | "active" | "unpaid" | "awaiting_dispatch" | "out_for_delivery" | "delivered";

const stageOptions: Array<{ value: StageFilter; label: string }> = [
  { value: "all", label: "All stages" },
  { value: "active", label: "Active" },
  { value: "unpaid", label: "Unpaid" },
  { value: "awaiting_dispatch", label: "Awaiting dispatch" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
];

function statusLabel(status: Job["status"]) {
  const labels: Record<Job["status"], string> = {
    pending_payment: "Queued",
    paid: "Queued",
    approved: "Released",
    printing: "Printing",
    printed: "Printed",
    failed: "Needs attention",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function deliveryLabel(job: Job) {
  if (job.deliveryMethod !== "delivery") return "Shop pickup";
  if (job.deliveryStatus === "delivered") return "Delivered";
  if (job.deliveryStatus === "out_for_delivery") return "Out for delivery";
  if (job.status === "printed") return "Awaiting dispatch";
  return "Delivery order";
}

function mapUrl(job: Job) {
  if (job.deliveryLatitude == null || job.deliveryLongitude == null) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${job.deliveryLatitude},${job.deliveryLongitude}`;
}

export default function OrderManagementPage() {
  const { data, error, isLoading, mutate } = useJobs();
  const [query, setQuery] = useState("");
  const [fulfilment, setFulfilment] = useState<FulfilmentFilter>("all");
  const [stage, setStage] = useState<StageFilter>("all");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const jobs: Job[] = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const cursor = data?.cursor ?? null;
  const hasMore = !!cursor;
  const authExpired = error?.message === "401";

  async function loadMore() {
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/admin/jobs?cursor=${encodeURIComponent(cursor)}`, {
        credentials: "include",
      });
      if (!response.ok) return;
      const body = await response.json();
      mutate((prev) => {
        if (!prev) return prev;
        return { ...prev, jobs: [...prev.jobs, ...(body.jobs ?? [])], cursor: body.cursor ?? null, total: body.total ?? prev.total };
      }, { revalidate: false });
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const customerQuery = new URLSearchParams(window.location.search).get("customer");
    if (customerQuery) setQuery(customerQuery);
  }, []);

  async function updateDelivery(job: Job, deliveryStatus: "out_for_delivery" | "delivered") {
    setUpdatingId(job.id);
    try {
      const response = await fetch(`/api/admin/jobs/${job.id}/delivery-status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryStatus }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to update delivery.");
      mutate();
    } catch (updateError) {
      // Error handled silently — next revalidation will fix stale data
    } finally {
      setUpdatingId(null);
    }
  }

  const summary = useMemo(() => ({
    total: jobs.length,
    active: jobs.filter((job) => !["printed", "cancelled"].includes(job.status)).length,
    awaitingDispatch: jobs.filter((job) =>
      job.deliveryMethod === "delivery"
      && job.status === "printed"
      && !["out_for_delivery", "delivered"].includes(job.deliveryStatus ?? "")
    ).length,
    onRoad: jobs.filter((job) => job.deliveryStatus === "out_for_delivery").length,
  }), [jobs]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (fulfilment !== "all" && job.deliveryMethod !== fulfilment) return false;
      if (stage === "active" && ["printed", "cancelled"].includes(job.status)) return false;
      if (stage === "unpaid" && (job.paidAt || job.status === "cancelled")) return false;
      if (stage === "awaiting_dispatch" && !(
        job.deliveryMethod === "delivery"
        && job.status === "printed"
        && !["out_for_delivery", "delivered"].includes(job.deliveryStatus ?? "")
      )) return false;
      if (stage === "out_for_delivery" && job.deliveryStatus !== "out_for_delivery") return false;
      if (stage === "delivered" && job.deliveryStatus !== "delivered") return false;
      if (!normalizedQuery) return true;
      return [
        job.token,
        job.customerName,
        job.customerPhone,
        job.deliveryAddress,
        job.file?.originalName,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [jobs, query, fulfilment, stage]);

  return (
    <AdminManagementNav
      title="Order management"
      subtitle="Search, prioritize, and dispatch print orders from one focused view."
      actions={
        <button type="button" className="management-refresh" onClick={() => mutate()} disabled={isLoading}>
          <RefreshCw size={16} className={isLoading ? "spin" : ""} aria-hidden="true" />
          Refresh
        </button>
      }
    >
      <main className="management-page">
        {authExpired ? (
          <div className="management-locked">
            <Lock size={30} aria-hidden="true" />
            <h2>Admin session expired</h2>
            <p>Sign in again to manage orders.</p>
            <Link href="/admin" className="management-primary-link">Go to admin login</Link>
          </div>
        ) : (
          <>
            <section className="management-kpis" aria-label="Order overview">
              <article><span className="kpi-icon total"><FileText size={19} /></span><div><strong>{summary.total}</strong><small>Total orders</small></div></article>
              <article><span className="kpi-icon active"><Clock3 size={19} /></span><div><strong>{summary.active}</strong><small>Active queue</small></div></article>
              <article><span className="kpi-icon dispatch"><PackageCheck size={19} /></span><div><strong>{summary.awaitingDispatch}</strong><small>Awaiting dispatch</small></div></article>
              <article><span className="kpi-icon road"><Truck size={19} /></span><div><strong>{summary.onRoad}</strong><small>Out for delivery</small></div></article>
            </section>

            <section className="management-workspace">
              <div className="management-toolbar">
                <label className="management-search">
                  <Search size={17} aria-hidden="true" />
                  <span className="sr-only">Search orders</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search token, customer, phone, address or file"
                  />
                </label>
                <div className="management-filter-group">
                  <div className="management-segmented" role="group" aria-label="Fulfilment filter">
                    {(["all", "pickup", "delivery"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={fulfilment === value ? "active" : ""}
                        onClick={() => setFulfilment(value)}
                      >
                        {value === "all" ? "All" : value === "pickup" ? "Pickup" : "Delivery"}
                      </button>
                    ))}
                  </div>
                  <label className="management-select">
                    <span className="sr-only">Filter by stage</span>
                    <select value={stage} onChange={(event) => setStage(event.target.value as StageFilter)}>
                      {stageOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {error && <div className="management-error" role="alert">{error.message}</div>}

              {isLoading && jobs.length === 0 ? (
                <ManagementSkeleton rows={5} />
              ) : filteredJobs.length === 0 ? (
                <div className="management-empty">
                  <Search size={28} aria-hidden="true" />
                  <h2>No matching orders</h2>
                  <p>Try a different search or filter.</p>
                </div>
              ) : (
                <div className="order-management-list">
                  {filteredJobs.map((job) => {
                    const directions = mapUrl(job);
                    const isUpdating = updatingId === job.id;
                    return (
                      <article className="order-management-card" key={job.id}>
                        <div className="order-card-main">
                          <div className="order-card-token">
                            <span>Token</span>
                            <strong>{job.token}</strong>
                          </div>
                          <div className="order-card-identity">
                            <div className="order-card-title">
                              <strong>{job.customerName || (job.deliveryMethod === "delivery" ? "Delivery customer" : "Walk-in customer")}</strong>
                              <span className={`order-status ${job.status}`}>{statusLabel(job.status)}</span>
                              <span className={`order-status fulfilment ${job.deliveryStatus ?? job.deliveryMethod}`}>
                                {deliveryLabel(job)}
                              </span>
                            </div>
                            <p>
                              {job.fileCount && job.fileCount > 1
                                ? `${job.fileCount} PDF files`
                                : job.file?.originalName || "Print file"}
                              {" · "}{job.copies} {job.copies === 1 ? "copy" : "copies"}
                              {" · "}{job.paperSize}
                            </p>
                            {job.deliveryMethod === "delivery" && (
                              <address>
                                <MapPinned size={14} aria-hidden="true" />
                                <span>{job.deliveryAddress || "No delivery address"}</span>
                              </address>
                            )}
                          </div>
                        </div>

                        <div className="order-card-finance">
                          <strong>₹{(job.pricePaise / 100).toFixed(2)}</strong>
                          <span className={job.paidAt ? "paid" : "unpaid"}>
                            <WalletCards size={13} aria-hidden="true" />
                            {job.paidAt ? "Paid" : "Unpaid"}
                          </span>
                          <time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString()}</time>
                        </div>

                        <div className="order-card-actions">
                          {job.customerPhone && (
                            <a href={`tel:${job.customerPhone}`} className="order-action secondary">
                              <Phone size={15} aria-hidden="true" /> Call
                            </a>
                          )}
                          {directions && (
                            <a href={directions} target="_blank" rel="noreferrer" className="order-action secondary">
                              <MapPinned size={15} aria-hidden="true" /> Directions
                            </a>
                          )}
                          <Link href={`/admin/jobs/${job.id}`} className="order-action secondary">
                            <ExternalLink size={15} aria-hidden="true" /> Details
                          </Link>
                          {job.deliveryMethod === "delivery"
                            && job.status === "printed"
                            && !["out_for_delivery", "delivered"].includes(job.deliveryStatus ?? "") && (
                            <button
                              type="button"
                              className="order-action primary"
                              disabled={isUpdating}
                              onClick={() => updateDelivery(job, "out_for_delivery")}
                            >
                              {isUpdating ? <Loader2 size={15} className="spin" /> : <Truck size={15} />}
                              Dispatch
                            </button>
                          )}
                          {job.deliveryStatus === "out_for_delivery" && (
                            <button
                              type="button"
                              className="order-action success"
                              disabled={isUpdating}
                              onClick={() => updateDelivery(job, "delivered")}
                            >
                              {isUpdating ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                              Mark delivered
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}

                  {total > 0 && (
                    <div className="jobs-count">
                      <span>
                        {query || fulfilment !== "all" || stage !== "all"
                          ? `${filteredJobs.length} matching · ${jobs.length} of ${total} loaded`
                          : `${jobs.length} of ${total} orders`}
                      </span>
                      {hasMore && (
                        <button type="button" className="load-more-btn" onClick={loadMore} disabled={loadingMore}>
                          {loadingMore ? <><Loader2 size={14} className="spin" /> Loading...</> : "Load more"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </AdminManagementNav>
  );
}
