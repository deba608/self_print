"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Check, Clock, CreditCard, Eye, FileText, Loader2,
  MapPinned, MessageCircleWarning, Printer, RefreshCw, Truck, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { manualPrint } from "@/lib/manualPrint";
import Badge, { type BadgeVariant } from "@/components/ui/Badge";
import type { Job } from "@/lib/types";

// Memoized (see export below): the dashboard re-renders on every SSE tick /
// poll, and without memo every card re-rendered each time. Callbacks take the
// job id so the parent can pass stable useCallback references.
function JobCard({
  job,
  selectionIndex,
  index,
  onToggleSelect,
  onAction,
  onView,
  actionLoading,
  onNotify
}: {
  job: Job;
  selectionIndex: number;   // 0 = not selected; 1+ = print order position
  index: number;
  onToggleSelect: (jobId: string) => void;
  onAction: (jobId: string, action: string) => void;
  onView: (jobId: string) => void;
  actionLoading: boolean;
  onNotify: (kind: "ok" | "err", msg: string) => void;
}) {
  const isSelected = selectionIndex > 0;
  // Print-progress status only — payment is tracked separately via job.paidAt
  // (see the paid pill below) so a job can be released/printed before it's paid.
  // Variant mapping follows docs/UI_UX_PLAN.md §1.2.
  const statusMap: Record<string, { label: string; variant: BadgeVariant; icon: LucideIcon }> = {
    pending_payment: { label: "Queued", variant: "info", icon: Clock },
    paid: { label: "Queued", variant: "info", icon: Clock }, // legacy rows from before payment was decoupled
    approved: { label: "Ready", variant: "primary", icon: Check },
    printing: { label: "Printing", variant: "primary", icon: Printer },
    printed: { label: "Done", variant: "success", icon: Check },
    failed: { label: "Failed", variant: "danger", icon: AlertTriangle },
    cancelled: { label: "Cancelled", variant: "neutral", icon: X },
  };

  const status = statusMap[job.status] || { label: job.status, variant: "neutral" as BadgeVariant, icon: Clock };
  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  const handleActionClick = (action: string) => {
    onAction(job.id, action);
  };

  const [printing, setPrinting] = useState(false);
  // Auto = release to the agent queue; Manual = print via the browser dialog
  // right now, no agent involved. Sticky per-card while it's on screen.
  const [printMode, setPrintMode] = useState<"auto" | "manual">("auto");
  const handleManualPrint = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPrinting(true);
    const res = await manualPrint(job.id);
    setPrinting(false);
    if (!res.ok) onNotify("err", res.error ?? "Manual print failed");
  };

  // Flash the card briefly whenever its status changes (SSE or action) so
  // staff notice updates without watching every row.
  const [flash, setFlash] = useState(false);
  const prevStatusRef = useRef(job.status);
  useEffect(() => {
    if (prevStatusRef.current === job.status) return;
    prevStatusRef.current = job.status;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
  }, [job.status]);

  return (
    <div className={`job-card ${job.status} ${flash ? "flash" : ""}`} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
      <button
          className={`job-checkbox ${isSelected ? "selected" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(job.id); }}
          aria-label={isSelected ? `Deselect job (position ${selectionIndex})` : "Select job"}
          type="button"
        >
          <span className={`checkbox-circle ${isSelected ? "checked numbered" : ""}`}>
            {isSelected ? selectionIndex : null}
          </span>
        </button>

      <div className="job-content">
        <div className="job-header">
          <div className="job-title">
            <span className="queue-num">#{job.queuePosition}</span>
            <span className="job-token">Token {job.token}</span>
          </div>
        </div>

        <div className="job-details">
          <span className="file-name">
            {job.fileCount != null && job.fileCount > 1 && (
              <span className="file-count-pill">
                <FileText size={11} aria-hidden="true" />
                {job.fileCount} files
              </span>
            )}
            {job.file?.originalName || "No file"}
          </span>
          <div className="job-time">
            <span>{new Date(job.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" })} at {new Date(job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>

        {job.needsConversion === 1 && (
          <div className="job-warning">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            Needs conversion before printing
          </div>
        )}

        {/* Customer-reported issue from /track — surfaced until staff resolves it. */}
        {job.issueReportedAt && !job.issueResolvedAt && (
          <div className="job-issue-flag" role="alert">
            <MessageCircleWarning size={14} aria-hidden="true" />
            <span className="job-issue-note" title={job.issueNote ?? undefined}>{job.issueNote || "Customer reported an issue"}</span>
            <button
              type="button"
              className="job-issue-resolve"
              onClick={(e) => { e.stopPropagation(); onAction(job.id, "resolve_issue"); }}
              disabled={actionLoading}
            >
              {actionLoading ? <Loader2 size={12} className="spin" /> : null}
              Resolve
            </button>
          </div>
        )}

        {job.deliveryMethod === "delivery" && (
          <div className="job-delivery-info">
            {job.deliveryStatus === "out_for_delivery" ? (
              <Badge variant="warning" icon={Truck}>Out for delivery</Badge>
            ) : job.deliveryStatus === "delivered" ? (
              <Badge variant="success" icon={Truck}>Delivered</Badge>
            ) : job.deliveryStatus === "picked_up" ? (
              <Badge variant="warning" icon={Truck}>Picked up by rider</Badge>
            ) : job.deliveryStatus === "packed" ? (
              <Badge variant="info" icon={Truck}>Packed</Badge>
            ) : (
              <Badge variant="info" icon={Truck}>Delivery</Badge>
            )}
            <span>{job.customerName} · {job.customerPhone}</span>
            <span className="job-delivery-address">
              {job.deliveryAddress}
              {job.deliveryPincode ? ` — ${job.deliveryPincode}` : ""}
              {job.deliveryArea ? ` (${job.deliveryArea})` : ""}
            </span>
            {job.deliveryLatitude != null && job.deliveryLongitude != null && (
              <a
                className="job-delivery-map"
                href={`https://www.google.com/maps/dir/?api=1&destination=${job.deliveryLatitude},${job.deliveryLongitude}`}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <MapPinned size={13} aria-hidden="true" />
                Open directions
                {job.deliveryAccuracyMeters != null && ` (±${Math.round(job.deliveryAccuracyMeters)} m)`}
              </a>
            )}
          </div>
        )}
      </div>

      <div className="job-side">
      <div className="job-actions">

        {/* Zone 1 — status: what state this job is in right now. */}
        <div className="job-actions-status">
          <Badge variant={status.variant} icon={status.icon}>{status.label}</Badge>
          {(job.status === "pending_payment" || job.status === "paid") && job.deliveryMethod === "delivery" && !job.paidAt && (
            <Badge variant="warning" icon={Clock}>Awaiting online payment</Badge>
          )}
        </div>

        {/* Zone 2 — primary action: the one thing to do next for this job. */}
        <div className="job-actions-primary">
          {(job.status === "pending_payment" || job.status === "paid") && !(job.deliveryMethod === "delivery" && !job.paidAt) && (
            <div className="print-mode-group">
              <div className="print-mode-switch" role="group" aria-label="Print mode">
                <button type="button" className={`print-mode-opt ${printMode === "auto" ? "active" : ""}`} onClick={() => setPrintMode("auto")}>
                  Auto
                </button>
                <button type="button" className={`print-mode-opt ${printMode === "manual" ? "active" : ""}`} onClick={() => setPrintMode("manual")}>
                  Manual
                </button>
              </div>
              <button
                type="button"
                className="job-btn release"
                onClick={(e) => printMode === "manual" ? handleManualPrint(e) : handleActionClick("approved")}
                disabled={printMode === "manual" ? printing : actionLoading}
              >
                {(printMode === "manual" ? printing : actionLoading) ? <Loader2 size={14} className="spin" /> : <Printer size={14} />}
                <span>{printMode === "manual" ? "Manual Print" : "Release"}</span>
              </button>
            </div>
          )}
          {(job.status === "approved" || job.status === "printing" || job.status === "failed") && (
            <button type="button" className="job-btn done" onClick={() => handleActionClick("printed")} disabled={actionLoading}>
              {actionLoading ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              <span>Done</span>
            </button>
          )}
          {job.deliveryMethod === "delivery" && job.status === "printed" && (!job.deliveryStatus || job.deliveryStatus === "pending") && (
            <button type="button" className="job-btn release" onClick={() => handleActionClick("packed")} disabled={actionLoading}>
              {actionLoading ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              <span>Mark Packed</span>
            </button>
          )}
          {job.deliveryMethod === "delivery" && job.status === "printed" && ["packed", "picked_up"].includes(job.deliveryStatus ?? "") && (
            <button type="button" className="job-btn release" onClick={() => handleActionClick("out_for_delivery")} disabled={actionLoading}>
              {actionLoading ? <Loader2 size={14} className="spin" /> : <Truck size={14} />}
              <span>Out for Delivery</span>
            </button>
          )}
          {job.deliveryMethod === "delivery" && job.deliveryStatus === "out_for_delivery" && (
            <button type="button" className="job-btn done" onClick={() => handleActionClick("delivered")} disabled={actionLoading}>
              {actionLoading ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              <span>Delivered</span>
            </button>
          )}
          {(job.status === "printed" || job.status === "failed") && (
            <button type="button" className="job-btn reprint" onClick={() => handleActionClick("reprint")} disabled={actionLoading}>
              {actionLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              <span>{job.status === "failed" ? "Retry" : "Reprint"}</span>
            </button>
          )}
        </div>

        {/* Zone 3 — utility + destructive: secondary, icon-only, visually
            demoted behind a divider so they never compete with the primary
            action. Cancel stays red and last, but now reads as "the other
            group" instead of just another button in the same row. */}
        <div className="job-actions-utility">
          {!["pending_payment", "paid", "cancelled"].includes(job.status) && (
            <button
              type="button"
              className="job-btn manual"
              onClick={handleManualPrint}
              disabled={printing}
              aria-label="Manual print via browser dialog"
              title="Backup: print via the browser/Windows print dialog"
            >
              {printing ? <Loader2 size={14} className="spin" /> : <Printer size={14} />}
            </button>
          )}
          <button type="button" className="job-btn view" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onView(job.id); }} aria-label="Open job details">
            <Eye size={14} />
          </button>
          {job.status !== "printed" && job.status !== "cancelled" && (
            <button type="button" className="job-btn cancel" onClick={() => handleActionClick("cancelled")} disabled={actionLoading} aria-label="Cancel job">
              {actionLoading ? <Loader2 size={14} className="spin" /> : <X size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Payment strip: right-aligned under the action row — amount, then
          payment status, then the pay action. One glance, one place. */}
      <div className="job-pay-row">
        <span className="job-price">{formatRupees(job.pricePaise)}</span>
        {job.paidAt ? (
          <Badge variant="success" icon={Check}>Paid</Badge>
        ) : job.status !== "cancelled" ? (
          <Badge variant="warning" icon={CreditCard}>Unpaid</Badge>
        ) : null}
        {!job.paidAt && job.status !== "cancelled" && (
          <button type="button" className="job-btn paid" onClick={() => handleActionClick("paid")} disabled={actionLoading} aria-label="Mark as paid">
            {actionLoading ? <Loader2 size={14} className="spin" /> : <CreditCard size={14} />}
            <span>Mark as Paid</span>
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

export default memo(JobCard);
