"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, Search, Truck, X } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ToastStack, useToasts } from "@/components/ui/Toast";
import type { Job, PricingConfig as Pricing } from "@/lib/types";
import { useJobs, useSummary, usePricing, usePrinter, usePrinters, useCurrentStaff } from "@/hooks/useAdmin";
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
import { createClient } from "@/lib/supabase/client";

export default function AdminDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── SWR data hooks ──────────────────────────────────────────────
  const { data: staff } = useCurrentStaff();
  const { data: jobsData, mutate: mutateJobs } = useJobs();
  const { data: summary, mutate: mutateSummary } = useSummary();
  const { data: pricing, mutate: mutatePricing } = usePricing();
  const { data: printerConfig, mutate: mutatePrinter } = usePrinter();

  // ── Supabase Realtime (WebSockets) ──────────────────────────────
  // Connects directly to Supabase — bypasses Vercel functions completely for live pushes!
  useEffect(() => {
    try {
      const supabase = createClient();
      const channel = supabase
        .channel("admin-jobs-realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "jobs" },
          () => {
            void mutateJobs();
            void mutateSummary();
          }
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    } catch {
      // Local dev / no Supabase env vars — fallback polling in useJobs handles it
    }
  }, [mutateJobs, mutateSummary]);

  const jobs: Job[] = jobsData?.jobs ?? [];
  const total = jobsData?.total ?? 0;
  const cursor = jobsData?.cursor ?? null;
  const hasMore = !!cursor;
  const bwPrinterName = printerConfig?.bwPrinterName ?? "";
  const colorPrinterName = printerConfig?.colorPrinterName ?? "";

  // ── Local UI state ──────────────────────────────────────────────
  const [loggingOut, setLoggingOut] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [printerPanelMode, setPrinterPanelMode] = useState<"bw" | "color" | null>(null);
  // Printers list is only shown inside PrinterPanel — poll it only while the
  // panel is open instead of continuous polling for the dashboard's whole lifetime.
  const { data: printersData } = usePrinters({ refreshInterval: printerPanelMode ? 15000 : 0 });
  const printers = printersData?.printers ?? [];
  const [showManageOrders, setShowManageOrders] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { collapsed: sidebarCollapsed, toggle: toggleSidebarCollapse } = useSidebarCollapse();
  const [newJobCount, setNewJobCount] = useState(0);
  const [selectedJobs, setSelectedJobs] = useState<string[]>([]);
  const [batchReleaseLoading, setBatchReleaseLoading] = useState(false);
  const [batchDeleteLoading, setBatchDeleteLoading] = useState(false);
  const [filterStatus, setFilterStatusState] = useState(() => searchParams.get("status") ?? "pending_payment");
  const [deliveryFilter, setDeliveryFilterState] = useState<"all" | "pickup" | "delivery">(
    () => (searchParams.get("fulfillment") as "all" | "pickup" | "delivery" | null) ?? "all"
  );
  const [tokenQuery, setTokenQuery] = useState(() => searchParams.get("q") ?? "");

  // Keep the current filters in the URL so navigating to a job's detail page
  // and back (or a browser back/forward) restores the queue view instead of
  // silently resetting to "All".
  const updateFilterParams = useCallback((status: string, fulfillment: "all" | "pickup" | "delivery") => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (fulfillment !== "all") params.set("fulfillment", fulfillment);
    const qs = params.toString();
    router.replace(qs ? `/admin?${qs}` : "/admin", { scroll: false });
  }, [router]);

  const setFilterStatus = useCallback((status: string) => {
    setFilterStatusState(status);
    updateFilterParams(status, deliveryFilter);
  }, [deliveryFilter, updateFilterParams]);

  const setDeliveryFilter = useCallback((fulfillment: "all" | "pickup" | "delivery") => {
    setDeliveryFilterState(fulfillment);
    updateFilterParams(filterStatus, fulfillment);
  }, [filterStatus, updateFilterParams]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ action: "cancelled" | "delivered"; jobId: string } | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [dismissedFailStreak, setDismissedFailStreak] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const { toasts, push: pushToast } = useToasts();

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

  // ── Keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    function isTypingTarget(el: Element | null) {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      const panelOpen = showSettings || printerPanelMode !== null || showManageOrders || confirmAction !== null || sidebarOpen;
      if (panelOpen) {
        if (e.key === "Escape") {
          if (confirmAction) setConfirmAction(null);
          else if (showSettings) setShowSettings(false);
          else if (printerPanelMode) setPrinterPanelMode(null);
          else if (showManageOrders) setShowManageOrders(false);
          else if (sidebarOpen) setSidebarOpen(false);
        }
        return;
      }
      const filterKeys = ["all", "pending_payment", "printing", "printed"];
      if (e.key >= "1" && e.key <= "4") {
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
  }, [mutateJobs, showSettings, printerPanelMode, showManageOrders, confirmAction, sidebarOpen]);

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

  async function savePricing(data: Omit<Pricing, "serviceArea">) {
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

  const jobAction = useCallback(async (jobId: string, action: string) => {
    setActionLoading(jobId);
    setActionError("");
    try {
      const isDeliveryAction = ["packed", "picked_up", "out_for_delivery", "delivered"].includes(action);
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
        resolve_issue: "Issue marked resolved", packed: "Marked packed",
        picked_up: "Marked picked up", out_for_delivery: "Marked out for delivery",
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
  }, [mutateJobs, pushToast, router]);

  async function batchPaid() {
    if (selectedJobs.length === 0) return;
    setBatchLoading(true);
    setActionError("");
    try {
      const responses = await Promise.all(selectedJobs.map(async (id) => {
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
      setSelectedJobs([]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update selected orders.");
    } finally {
      setBatchLoading(false);
    }
  }

  // Releases jobs to the print queue one-by-one in the exact order the admin
  // tapped them. Sequential awaits ensure the agent picks them up in order.
  async function batchRelease() {
    if (selectedJobs.length === 0) return;
    setBatchReleaseLoading(true);
    setActionError("");
    try {
      for (const id of selectedJobs) {
        const response = await fetch(`/api/admin/jobs/${id}/status`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" })
        });
        if (response.status === 401) { router.push("/admin"); return; }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "Unable to release one or more jobs.");
      }
      mutateJobs();
      setSelectedJobs([]);
      pushToast("ok", `${selectedJobs.length} job${selectedJobs.length > 1 ? "s" : ""} released to print queue`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to release selected orders.";
      setActionError(msg);
      pushToast("err", msg);
    } finally {
      setBatchReleaseLoading(false);
    }
  }

  async function batchDelete() {
    if (selectedJobs.length === 0) return;
    setBatchDeleteLoading(true);
    setActionError("");
    try {
      const response = await fetch("/api/admin/jobs/bulk-delete", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedJobs })
      });
      if (response.status === 401) { router.push("/admin"); return; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Unable to delete selected orders.");
      mutateJobs();
      mutateSummary();
      setSelectedJobs([]);
      pushToast("ok", `${body.deleted ?? selectedJobs.length} job${(body.deleted ?? selectedJobs.length) > 1 ? "s" : ""} deleted`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unable to delete selected orders.";
      setActionError(msg);
      pushToast("err", msg);
    } finally {
      setBatchDeleteLoading(false);
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

  const toggleSelect = useCallback((id: string) => {
    setSelectedJobs((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  }, []);

  // Stable per-card handlers so memo(JobCard) can skip re-renders on
  // dashboard-wide state churn (poll refreshes, unseen counter, toasts).
  const handleCardAction = useCallback((jobId: string, action: string) => {
    if (action === "cancelled" || action === "delivered") {
      setConfirmAction({ action, jobId });
    } else {
      jobAction(jobId, action);
    }
  }, [jobAction]);

  const handleCardView = useCallback((jobId: string) => {
    router.push(`/admin/jobs/${jobId}`);
  }, [router]);

  function selectAll() {
    const eligible = filteredJobs.map((j) => j.id);
    const allSelected = selectedJobs.length === eligible.length && eligible.length > 0;
    setSelectedJobs(allSelected ? [] : eligible);
  }

  // ── Derived data ────────────────────────────────────────────────
  // Stable array for ManageOrdersPanel — without useMemo the panel re-rendered
  // on every dashboard render (interval poll) because .map created a fresh array.
  const manageOrdersJobs = useMemo(() => jobs.map((j) => ({
    id: j.id, token: j.token, status: j.status,
    pricePaise: j.pricePaise, createdAt: j.createdAt, file: j.file
  })), [jobs]);
  const methodFilteredJobs = deliveryFilter === "all"
    ? jobs
    : jobs.filter((j) => (j.deliveryMethod ?? "pickup") === deliveryFilter);
  const statusFilteredJobs = filterStatus === "all"
    ? methodFilteredJobs
    : filterStatus === "pending_payment"
      ? methodFilteredJobs.filter((j) => j.status === "pending_payment" || j.status === "paid")
      : filterStatus === "printing"
        ? methodFilteredJobs.filter((j) => j.status === "approved" || j.status === "printing")
        : methodFilteredJobs.filter((j) => j.status === filterStatus);
  const normalizedTokenQuery = tokenQuery.trim().toLowerCase();
  const filteredJobs = !normalizedTokenQuery
    ? statusFilteredJobs
    : statusFilteredJobs.filter((j) =>
        [j.token, j.customerName, j.customerPhone, j.file?.originalName].some((value) =>
          value?.toLowerCase().includes(normalizedTokenQuery)
        )
      );
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
    { value: "printing", label: "Printing" },
    { value: "printed", label: "Done" },
  ];

  const counts = statusFilters.reduce((acc, f) => {
    acc[f.value] = f.value === "all"
      ? jobs.length
      : f.value === "pending_payment"
        ? jobs.filter((j) => j.status === "pending_payment" || j.status === "paid").length
        : f.value === "printing"
          ? jobs.filter((j) => j.status === "approved" || j.status === "printing").length
          : jobs.filter((j) => j.status === f.value).length;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className={`admin-layout${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <AdminTopbar
        bwPrinterName={bwPrinterName}
        colorPrinterName={colorPrinterName}
        newJobCount={newJobCount}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        onRefresh={() => { mutateJobs(); }}
        onOpenPricing={() => { setShowSettings(true); setPrinterPanelMode(null); }}
        onOpenPrinter={(mode) => { setPrinterPanelMode(mode); setShowSettings(false); }}
        onLogout={logout}
        loggingOut={loggingOut}
        staffName={staff?.displayName || staff?.email}
        showPricing={showSettings}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        isSuperAdmin={staff?.role === "super_admin"}
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

      {printerPanelMode && (
        <PrinterPanel
          mode={printerPanelMode}
          printers={printers}
          selectedPrinter={printerPanelMode === "color" ? colorPrinterName : bwPrinterName}
          onSelect={async (name) => {
            const field = printerPanelMode === "color" ? "colorPrinterName" : "bwPrinterName";
            await fetch("/api/admin/printer", {
              method: "PUT", credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ [field]: name })
            });
            mutatePrinter({
              bwPrinterName: printerPanelMode === "bw" ? name : bwPrinterName,
              colorPrinterName: printerPanelMode === "color" ? name : colorPrinterName,
              configVersion: (printerConfig?.configVersion ?? 0) + 1
            });
          }}
          onClose={() => setPrinterPanelMode(null)}
        />
      )}

      {showManageOrders && (
        <ManageOrdersPanel
          jobs={manageOrdersJobs}
          onClose={() => setShowManageOrders(false)}
          onRefresh={() => { mutateJobs(); mutateSummary(); }}
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


      <div className="admin-search-row">
        <label className="management-search admin-token-search" htmlFor="dashboard-token-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search token, customer, phone or file</span>
          <input
            id="dashboard-token-search"
            type="search"
            value={tokenQuery}
            onChange={(e) => setTokenQuery(e.target.value)}
            placeholder="Search token, customer, phone or file…"
            autoComplete="off"
          />
          {tokenQuery && (
            <button type="button" className="management-search-clear" onClick={() => setTokenQuery("")} aria-label="Clear search">
              &times;
            </button>
          )}
        </label>
      </div>

      <div className="admin-filter-row">
        <div className="admin-filter-group">
          <span className="admin-filter-label">Status</span>
          <FilterTabs filters={statusFilters} activeFilter={filterStatus} counts={counts} onFilterChange={setFilterStatus} />
        </div>
        <div className="admin-filter-group admin-filter-group-end">
          <span className="admin-filter-label">Fulfillment</span>
          <div className="delivery-filter-toggle" role="group" aria-label="Filter by fulfillment method">
            {(["all", "pickup", "delivery"] as const).map((f) => (
              <button type="button" key={f} className={`delivery-filter-btn ${deliveryFilter === f ? "active" : ""}`}
                onClick={() => setDeliveryFilter(f)} aria-pressed={deliveryFilter === f}>
                {f === "all" ? "All Orders" : f === "pickup" ? "Self Pickup" : "Home Delivery"}
                {f === "delivery" && outForDeliveryCount > 0 && (
                  <span className="delivery-filter-count" title={`${outForDeliveryCount} out for delivery`}>
                    <Truck size={12} aria-hidden="true" />{outForDeliveryCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredJobs.length > 0 && (
        <BatchBar
          selectedCount={selectedJobs.length}
          totalUnpaid={filteredJobs.length}
          onSelectAll={selectAll}
          onBatchPaid={batchPaid}
          onBatchRelease={batchRelease}
          onBatchDelete={batchDelete}
          onClear={() => setSelectedJobs([])}
          loading={batchLoading}
          releaseLoading={batchReleaseLoading}
          deleteLoading={batchDeleteLoading}
        />
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
            <JobCard
              key={job.id}
              job={job}
              selectionIndex={selectedJobs.indexOf(job.id) + 1}
              index={index}
              onToggleSelect={toggleSelect}
              onAction={handleCardAction}
              onView={handleCardView}
              actionLoading={actionLoading === job.id} onNotify={pushToast}
              printerCanDuplex={
                printers.find((p) => p.name === (job.printType === "color" ? colorPrinterName : bwPrinterName))?.canDuplex
              } />
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
