"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Truck, X } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ToastStack, useToasts } from "@/components/ui/Toast";
import type { Job, PricingConfig as Pricing } from "@/lib/types";
import { useJobs, usePricing, usePrinter, usePrinters, useCurrentStaff } from "@/hooks/useAdmin";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";

import AdminTopbar from "@/components/admin/AdminTopbar";
import AdminSidebar from "@/components/admin/AdminSidebar";
import FilterTabs from "@/components/admin/FilterTabs";
import BatchBar from "@/components/admin/BatchBar";
import JobCard from "@/components/admin/JobCard";
import EmptyState from "@/components/admin/EmptyState";
import PricingPanel from "@/components/admin/PricingPanel";
import PrinterPanel from "@/components/admin/PrinterPanel";
import ManageOrdersPanel from "@/components/admin/ManageOrdersPanel";

export default function AdminDashboard() {
  const router = useRouter();

  // ── SWR data hooks ──────────────────────────────────────────────
  const { data: staff } = useCurrentStaff();
  const { data: jobsData, mutate: mutateJobs } = useJobs();
  const { data: pricing, mutate: mutatePricing } = usePricing();
  const { data: printerConfig, mutate: mutatePrinter } = usePrinter();
  const { data: printersData } = usePrinters();

  const jobs: Job[] = jobsData?.jobs ?? [];
  const total = jobsData?.total ?? 0;
  const cursor = jobsData?.cursor ?? null;
  const hasMore = !!cursor;
  const printerName = printerConfig?.printerName ?? "";
  const printers = printersData?.printers ?? [];

  // ── Local UI state ──────────────────────────────────────────────
  const [loggingOut, setLoggingOut] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPrinter, setShowPrinter] = useState(false);
  const [showManageOrders, setShowManageOrders] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebarCollapse } = useSidebarCollapse();
  const [newJobCount, setNewJobCount] = useState(0);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState<"all" | "pickup" | "delivery">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ action: "cancelled" | "delivered"; jobId: string } | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [dismissedFailStreak, setDismissedFailStreak] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const { toasts, push: pushToast } = useToasts();
  const esRef = useRef<EventSource | null>(null);

  // ── Sound + chime ───────────────────────────────────────────────
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("selfprint:admin:sound");
      if (stored === "0") setSoundOn(false);
    } catch { /* private mode */ }
  }, []);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(soundOn);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

  const playChime = useCallback(() => {
    if (!soundOnRef.current) return;
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      [[880, 0], [1318.5, 0.14]].forEach(([freq, at]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.32);
      });
    } catch { /* audio unavailable */ }
  }, []);

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    soundOnRef.current = next;
    try { localStorage.setItem("selfprint:admin:sound", next ? "1" : "0"); } catch { /* private mode */ }
    if (next) playChime();
  }

  // ── Tab title badge for unseen new jobs ──────────────────────────
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const baseTitle = document.title;
    if (unseen > 0) document.title = `(${unseen}) New order${unseen > 1 ? "s" : ""} — ${baseTitle.replace(/^\(\d+\)[^—]*— /, "")}`;
    return () => { document.title = baseTitle.replace(/^\(\d+\)[^—]*— /, ""); };
  }, [unseen]);
  useEffect(() => {
    const clear = () => setUnseen(0);
    window.addEventListener("focus", clear);
    document.addEventListener("visibilitychange", clear);
    return () => { window.removeEventListener("focus", clear); document.removeEventListener("visibilitychange", clear); };
  }, []);

  // ── SSE real-time connection ─────────────────────────────────────
  // Keeps jobs data fresh via SSE; falls back to SWR revalidation.
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownIdsRef.current = new Set(jobs.map((j) => j.id));
  }, [jobs]);

  async function connectSSE() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("/api/admin/notifications");
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "job_update") {
          mutateJobs((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              jobs: prev.jobs.map((j) =>
                j.id === data.jobId
                  ? { ...j, status: data.status, paidAt: data.paidAt ?? j.paidAt, deliveryStatus: data.deliveryStatus ?? j.deliveryStatus }
                  : j
              ),
            };
          }, { revalidate: false });
        } else if (data.type === "new_job" || data.type === "issue_reported") {
          playChime();
          setUnseen((n) => n + 1);
          mutateJobs();
        }
      } catch {
        mutateJobs();
      }
    };
    es.onerror = () => { setTimeout(connectSSE, 5000); };
    esRef.current = es;
  }

  useEffect(() => {
    connectSSE();
    return () => { if (esRef.current) esRef.current.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    function isTypingTarget(el: Element | null) {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      const panelOpen = showSettings || showPrinter || showManageOrders || confirmAction !== null || sidebarOpen;
      if (panelOpen) {
        if (e.key === "Escape") {
          if (confirmAction) setConfirmAction(null);
          else if (showSettings) setShowSettings(false);
          else if (showPrinter) setShowPrinter(false);
          else if (showManageOrders) setShowManageOrders(false);
          else if (sidebarOpen) setSidebarOpen(false);
        }
        return;
      }
      const filterKeys = ["all", "pending_payment", "unpaid", "approved", "printing", "printed"];
      if (e.key >= "1" && e.key <= "6") {
        e.preventDefault();
        setFilterStatus(filterKeys[Number(e.key) - 1]);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        mutateJobs();
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        setShowSettings((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mutateJobs, showSettings, showPrinter, showManageOrders, confirmAction, sidebarOpen]);

  // ── Actions ─────────────────────────────────────────────────────
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const response = await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("We could not sign you out. Please try again.");
      router.push("/admin");
      router.refresh();
    } catch (error) {
      pushToast("err", error instanceof Error ? error.message : "Unable to sign out.");
      setLoggingOut(false);
    }
  }

  async function savePricing(data: Pricing) {
    const response = await fetch("/api/admin/pricing", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Pricing update failed");
    mutatePricing(body);
    mutateJobs();
  }

  async function jobAction(jobId: string, action: string) {
    setActionLoading(jobId);
    setActionError("");
    try {
      const isDeliveryAction = action === "out_for_delivery" || action === "delivered";
      const endpoint = action === "convert"
        ? `/api/admin/jobs/${jobId}/convert`
        : action === "reprint"
          ? `/api/admin/jobs/${jobId}/reprint`
          : action === "resolve_issue"
            ? `/api/admin/jobs/${jobId}/resolve-issue`
            : isDeliveryAction
              ? `/api/admin/jobs/${jobId}/delivery-status`
              : `/api/admin/jobs/${jobId}/status`;
      const noBodyActions = ["reprint", "convert", "resolve_issue"];
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: noBodyActions.includes(action)
          ? undefined
          : JSON.stringify(isDeliveryAction ? { deliveryStatus: action } : { status: action })
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) { router.push("/admin"); return; }
      if (!response.ok) throw new Error(body.error ?? "Unable to update this order.");
      if (body.job) {
        mutateJobs((prev) => {
          if (!prev) return prev;
          return { ...prev, jobs: prev.jobs.map((j) => j.id === jobId ? { ...j, ...body.job } : j) };
        }, { revalidate: false });
      } else {
        mutateJobs();
      }
      const toastMsg: Record<string, string> = {
        paid: "Marked as paid", approved: "Print released", printed: "Marked as done",
        reprint: "Reprint queued", cancelled: "Job cancelled", convert: "Conversion started",
        resolve_issue: "Issue marked resolved", out_for_delivery: "Marked out for delivery",
        delivered: "Marked delivered",
      };
      pushToast("ok", toastMsg[action] ?? "Job updated");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to update this order.";
      setActionError(msg);
      pushToast("err", msg);
    } finally {
      setActionLoading(null);
    }
  }

  async function batchAction() {
    const ids = Array.from(selectedJobs);
    if (ids.length === 0) return;
    setBatchLoading(true);
    setActionError("");
    try {
      const responses = await Promise.all(ids.map(async (id) => {
        const response = await fetch(`/api/admin/jobs/${id}/status`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paid" })
        });
        const body = await response.json().catch(() => ({}));
        return { response, body };
      }));
      if (responses.some(({ response }) => response.status === 401)) { router.push("/admin"); return; }
      const failed = responses.find(({ response }) => !response.ok);
      if (failed) throw new Error(failed.body.error ?? "Unable to update selected orders.");
      mutateJobs();
      setSelectedJobs(new Set());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update selected orders.");
    } finally {
      setBatchLoading(false);
    }
  }

  async function loadMore() {
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/admin/jobs?cursor=${encodeURIComponent(cursor)}`, { credentials: "include" });
      if (!res.ok) return;
      const body = await res.json();
      mutateJobs((prev) => {
        if (!prev) return prev;
        return { ...prev, jobs: [...prev.jobs, ...(body.jobs ?? [])], cursor: body.cursor ?? null, total: body.total ?? prev.total };
      }, { revalidate: false });
    } finally {
      setLoadingMore(false);
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedJobs);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedJobs(next);
  }

  function selectAll() {
    const unpaid = filteredJobs.filter((j) => !j.paidAt && j.status !== "cancelled").map((j) => j.id);
    const allSelected = selectedJobs.size === unpaid.length && unpaid.length > 0;
    setSelectedJobs(allSelected ? new Set() : new Set(unpaid));
  }

  // ── Derived data ────────────────────────────────────────────────
  const methodFilteredJobs = deliveryFilter === "all"
    ? jobs
    : jobs.filter((j) => (j.deliveryMethod ?? "pickup") === deliveryFilter);
  const filteredJobs = filterStatus === "all"
    ? methodFilteredJobs
    : filterStatus === "unpaid"
      ? methodFilteredJobs.filter((j) => !j.paidAt && j.status !== "cancelled")
      : filterStatus === "pending_payment"
        ? methodFilteredJobs.filter((j) => j.status === "pending_payment" || j.status === "paid")
        : methodFilteredJobs.filter((j) => j.status === filterStatus);
  const pending = jobs.filter((j) => !j.paidAt && j.status !== "cancelled");
  const outForDeliveryCount = jobs.filter((j) => j.deliveryStatus === "out_for_delivery").length;

  const recentAttempts = [...jobs]
    .filter((j) => j.status === "printed" || j.status === "failed")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  let failStreak = 0;
  for (const j of recentAttempts) {
    if (j.status === "failed") failStreak++;
    else break;
  }

  const statusFilters = [
    { value: "all", label: "All" },
    { value: "pending_payment", label: "Queued" },
    { value: "unpaid", label: "Unpaid" },
    { value: "approved", label: "Ready" },
    { value: "printing", label: "Printing" },
    { value: "printed", label: "Done" },
  ];

  const counts = statusFilters.reduce((acc, f) => {
    acc[f.value] = f.value === "all"
      ? jobs.length
      : f.value === "unpaid"
        ? jobs.filter((j) => !j.paidAt && j.status !== "cancelled").length
        : f.value === "pending_payment"
          ? jobs.filter((j) => j.status === "pending_payment" || j.status === "paid").length
          : jobs.filter((j) => j.status === f.value).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className={`admin-layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <AdminTopbar
        printerName={printerName}
        newJobCount={newJobCount}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        onRefresh={() => { mutateJobs(); }}
        onOpenPricing={() => { setShowSettings(true); setShowPrinter(false); setShowManageOrders(false); }}
        onOpenPrinter={() => { setShowPrinter(true); setShowSettings(false); setShowManageOrders(false); }}
        onOpenManageOrders={() => { setShowManageOrders(true); setShowSettings(false); setShowPrinter(false); }}
        onLogout={logout}
        loggingOut={loggingOut}
        staffName={staff?.displayName || staff?.email}
        showPricing={showSettings}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        pageTitle="Job Queue"
        subbar={
          <>
            <div className="subbar-group">
              <span className="subbar-label">Status</span>
              <FilterTabs filters={statusFilters} activeFilter={filterStatus} counts={counts} onFilterChange={setFilterStatus} />
            </div>
            <div className="subbar-group subbar-group-end">
              <span className="subbar-label">Fulfillment</span>
              <div className="delivery-filter-toggle" role="group" aria-label="Filter by fulfillment method">
                {(["all", "pickup", "delivery"] as const).map((f) => (
                  <button type="button" key={f} className={`delivery-filter-btn ${deliveryFilter === f ? "active" : ""}`}
                    onClick={() => setDeliveryFilter(f)} aria-pressed={deliveryFilter === f}>
                    {f === "all" ? "All Orders" : f === "pickup" ? "Pickup" : "Delivery"}
                    {f === "delivery" && outForDeliveryCount > 0 && (
                      <span className="delivery-filter-count" title={`${outForDeliveryCount} out for delivery`}>
                        <Truck size={12} aria-hidden="true" />{outForDeliveryCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <StatsBar activeJobs={activeJobs.length} todayRevenue={summary?.totalPaise ?? 0} />
            </div>
          </>
        }
      />
      <AdminSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />
      <main className="admin-shell">

      {showSettings && pricing && (
        <PricingPanel
          pricing={pricing}
          onSave={savePricing}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showPrinter && (
        <PrinterPanel
          printers={printers}
          selectedPrinter={printerName}
          onSelect={async (name) => {
            await fetch("/api/admin/printer", {
              method: "PUT", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ printerName: name })
            });
            mutatePrinter({ printerName: name, configVersion: (printerConfig?.configVersion ?? 0) + 1 });
          }}
          onClose={() => setShowPrinter(false)}
        />
      )}

      {showManageOrders && (
        <ManageOrdersPanel
          jobs={jobs.map((j) => ({
            id: j.id, token: j.token, status: j.status,
            pricePaise: j.pricePaise, createdAt: j.createdAt, file: j.file
          }))}
          onClose={() => setShowManageOrders(false)}
          onRefresh={() => { mutateJobs(); }}
        />
      )}

      {failStreak >= 2 && failStreak > dismissedFailStreak && (
        <div className="printer-trouble-banner" role="alert">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>{failStreak} prints failed in a row</strong>
            <p>Check the printer for paper, ink/toner, or a jam before releasing more jobs.</p>
          </div>
          <button type="button" onClick={() => setDismissedFailStreak(failStreak)} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}


      {pending.length > 0 && (
        <BatchBar selectedCount={selectedJobs.size} totalUnpaid={pending.length}
          onSelectAll={selectAll} onBatchPaid={batchAction}
          onClear={() => setSelectedJobs(new Set())} loading={batchLoading} />
      )}

      {actionError && (
        <div className="admin-action-error" role="alert">
          {actionError}
          <button type="button" onClick={() => setActionError("")} aria-label="Dismiss error"><X size={16} /></button>
        </div>
      )}

      {!jobsData ? (
        <div className="job-list" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="job-skeleton">
              <div className="sk-line w60" /><div className="sk-line w40" /><div className="sk-line w80" />
            </div>
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <EmptyState message={filterStatus === "all" ? "Waiting for customer uploads..." : `No ${filterStatus} jobs`} />
      ) : (
        <div className="job-list">
          {filteredJobs.map((job, index) => (
            <JobCard key={job.id} job={job} isSelected={selectedJobs.has(job.id)} index={index}
              onToggleSelect={() => toggleSelect(job.id)}
              onAction={(action) => action === "cancelled" || action === "delivered"
                ? setConfirmAction({ action, jobId: job.id })
                : jobAction(job.id, action)}
              onView={() => window.location.href = `/admin/jobs/${job.id}`}
              actionLoading={actionLoading === job.id} onNotify={pushToast} />
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="jobs-count" aria-live="polite" aria-atomic="true">
          <span>
            {filterStatus === "all"
              ? `${jobs.length} of ${total} jobs`
              : `${filteredJobs.length} matching · ${jobs.length} of ${total} loaded`}
          </span>
          {hasMore && (
            <button type="button" className="load-more-btn" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <><Loader2 size={14} className="spin" /> Loading...</> : "Load more"}
            </button>
          )}
          <span className="kbd-hint" title="Keyboard shortcuts: R=Refresh, 1-6=Filter tabs, P=Pricing, Esc=Close panels">
            <kbd>R</kbd> refresh · <kbd>1</kbd>–<kbd>6</kbd> filter · <kbd>P</kbd> pricing
          </span>
        </div>
      )}

      <ConfirmDialog open={confirmAction !== null}
        title={confirmAction?.action === "cancelled" ? "Cancel this job?" : "Mark as delivered?"}
        message={confirmAction?.action === "cancelled"
          ? "The job will be cancelled and removed from the active queue. This cannot be undone."
          : "Confirm the order was handed to the customer. This completes the delivery."}
        confirmLabel={confirmAction?.action === "cancelled" ? "Cancel job" : "Mark delivered"}
        danger={confirmAction?.action === "cancelled"}
        onConfirm={() => { const pending = confirmAction; setConfirmAction(null); if (pending) jobAction(pending.jobId, pending.action); }}
        onCancel={() => setConfirmAction(null)} />

      <ToastStack toasts={toasts} />
      </main>
    </div>
  );
}
