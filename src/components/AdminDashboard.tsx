"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Truck, X } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ToastStack, useToasts } from "@/components/ui/Toast";
import type { StaffProfile, Job, PricingConfig as Pricing, PrinterOption } from "@/lib/types";

import AdminTopbar from "@/components/admin/AdminTopbar";
import StatsBar from "@/components/admin/StatsBar";
import FilterTabs from "@/components/admin/FilterTabs";
import BatchBar from "@/components/admin/BatchBar";
import JobCard from "@/components/admin/JobCard";
import EmptyState from "@/components/admin/EmptyState";
import PricingPanel from "@/components/admin/PricingPanel";
import PrinterPanel from "@/components/admin/PrinterPanel";
import ManageOrdersPanel from "@/components/admin/ManageOrdersPanel";

// Main Dashboard Component
export default function AdminDashboard() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentStaff, setCurrentStaff] = useState<StaffProfile | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [summary, setSummary] = useState({ jobs: 0, totalPaise: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [showPrinter, setShowPrinter] = useState(false);
  const [showManageOrders, setShowManageOrders] = useState(false);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [printerName, setPrinterName] = useState("");
  const [newJobCount, setNewJobCount] = useState(0);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState("all");
  const [deliveryFilter, setDeliveryFilter] = useState<"all" | "pickup" | "delivery">("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  // Shared confirm state for destructive / hard-to-reverse job actions.
  const [confirmAction, setConfirmAction] = useState<{ action: "cancelled" | "delivered"; jobId: string } | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [dismissedFailStreak, setDismissedFailStreak] = useState(0);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const { toasts, push: pushToast } = useToasts();
  const esRef = useRef<EventSource | null>(null);

  // New-job chime + tab-title flash so a busy counter notices uploads (ON by default).
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("selfprint:admin:sound");
      if (stored === "0") {
        setSoundOn(false);
      } else {
        setSoundOn(true);
      }
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
      // Two quick ascending tones — friendly "new order" ding.
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
    // The toggle click is a user gesture — create/resume the context now so
    // later SSE-triggered chimes are allowed to play, and preview the sound.
    if (next) playChime();
  }

  // Unseen new jobs while the tab is unfocused → "(2) New orders" title.
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

  // Auto-refresh baseline: poll the job list every 5s regardless of SSE state
  // (serverless/proxied deployments can silently drop or never establish the
  // long-lived SSE connection, so relying on it alone leaves the dashboard
  // stale). SSE still delivers instant updates when it's actually connected;
  // this poll guarantees new orders never take longer than 5s to show up.
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    knownIdsRef.current = new Set(jobs.map((j) => j.id));
  }, [jobs]);
  useEffect(() => {
    if (!loggedIn) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/jobs", { credentials: "include" });
        if (!res.ok) return;
        const body = await res.json();
        const fresh: Job[] = body.jobs ?? [];
        const newOnes = fresh.filter((j) => !knownIdsRef.current.has(j.id));
        if (newOnes.length > 0 && knownIdsRef.current.size > 0) {
          playChime();
          setUnseen((n) => n + newOnes.length);
        }
        setJobs(fresh);
        setCursor(body.cursor ?? null);
        setHasMore(!!body.cursor);
        setTotal(body.total ?? 0);
        const summaryRes = await fetch("/api/admin/summary", { credentials: "include" });
        if (summaryRes.ok) setSummary(await summaryRes.json());
      } catch { /* transient — next tick retries */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [loggedIn, playChime]);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/jobs", { credentials: "include" });
    if (response.status === 401) { setLoggedIn(false); router.push("/admin"); return; }
    const body = await response.json();
    setJobs(body.jobs ?? []);
    setCursor(body.cursor ?? null);
    setHasMore(!!body.cursor);
    setTotal(body.total ?? 0);
    setNewJobCount(0);
    setJobsLoaded(true);
    setLoggedIn(true);
    const summaryResponse = await fetch("/api/admin/summary", { credentials: "include" });
    setSummary(await summaryResponse.json());
    loadPricing();
    loadPrinter();
  }, [router]);

  async function loadPricing() {
    const res = await fetch("/api/admin/pricing", { credentials: "include" });
    const data = await res.json();
    setPricing(data);
  }

  async function loadPrinter() {
    const res = await fetch("/api/admin/printer", { credentials: "include" });
    const data = await res.json();
    setPrinterName(data.printerName || "");
    const printersRes = await fetch("/api/admin/printers", { credentials: "include" });
    if (printersRes.ok) {
      const printersData = await printersRes.json();
      setPrinters(printersData.printers ?? []);
    }
  }

  async function loadMore() {
    if (!hasMore || loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/admin/jobs?cursor=${encodeURIComponent(cursor)}`, { credentials: "include" });
      if (!res.ok) return;
      const body = await res.json();
      setJobs(prev => [...prev, ...(body.jobs ?? [])]);
      setCursor(body.cursor ?? null);
      setHasMore(!!body.cursor);
      setTotal(body.total ?? 0);
    } finally {
      setLoadingMore(false);
    }
  }

  async function connectSSE() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("/api/admin/notifications");
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "job_update") {
          // Update only the changed job status/paidAt/deliveryStatus in place
          setJobs((prev) => prev.map((j) => j.id === data.jobId ? { ...j, status: data.status, paidAt: data.paidAt ?? j.paidAt, deliveryStatus: data.deliveryStatus ?? j.deliveryStatus } : j));
        } else if (data.type === "new_job") {
          playChime();
          setUnseen((n) => n + 1);
          // Reload to get the new job with full details
          load();
        } else if (data.type === "issue_reported") {
          playChime();
          setUnseen((n) => n + 1);
          load();
        }
      } catch {
        // If SSE message is malformed, do a full reload
        load();
      }
    };
    es.onerror = () => { setTimeout(connectSSE, 5000); };
    esRef.current = es;
  }

  useEffect(() => {
    if (loggedIn) {
      connectSSE();
      return () => { if (esRef.current) esRef.current.close(); };
    }
  }, [loggedIn]);

  useEffect(() => { load(); }, [load]);

  // Keyboard shortcuts for busy counter operators.
  // Skip when typing in an input, textarea, select, or contentEditable.
  useEffect(() => {
    function isTypingTarget(el: Element | null) {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(document.activeElement)) return;
      // Don't intercept when a panel/dialog is open — Esc handled separately
      const panelOpen = showSettings || showPrinter || showManageOrders || confirmAction !== null;
      if (panelOpen) {
        if (e.key === "Escape") {
          if (confirmAction) setConfirmAction(null);
          else if (showSettings) setShowSettings(false);
          else if (showPrinter) setShowPrinter(false);
          else if (showManageOrders) setShowManageOrders(false);
        }
        return;
      }
      const filterKeys = ["all", "pending_payment", "unpaid", "approved", "printing", "printed"];
      if (e.key >= "1" && e.key <= "6") {
        e.preventDefault();
        setFilterStatus(filterKeys[Number(e.key) - 1]);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        load();
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        setShowSettings((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load, showSettings, showPrinter, showManageOrders, confirmAction]);

  // Auth check: the dashboard itself no longer renders a login form — it
  // relies on a Supabase session having already been established via /login.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/me", { credentials: "include" });
        if (res.status === 401) {
          router.push("/admin");
          return;
        }
        if (res.ok) {
          setCurrentStaff(await res.json());
        }
      } catch {
        // transient — the periodic job poll / actions will surface a 401 if the session is truly gone
      }
    })();
  }, [router]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      const response = await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
      if (!response.ok) {
        throw new Error("We could not sign you out. Please try again.");
      }
      setLoggedIn(false);
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
    if (!response.ok) {
      throw new Error(body.error ?? "Pricing update failed");
    }
    setPricing(body);
    await load();
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
      if (response.status === 401) {
        setLoggedIn(false);
        router.push("/admin");
        return;
      }
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to update this order.");
      }
      if (body.job) {
        setJobs((prev) => prev.map((job) => job.id === jobId ? { ...job, ...body.job } : job));
      } else {
        await load();
      }
      const toastMsg: Record<string, string> = {
        paid: "Marked as paid",
        approved: "Print released",
        printed: "Marked as done",
        reprint: "Reprint queued",
        cancelled: "Job cancelled",
        convert: "Conversion started",
        resolve_issue: "Issue marked resolved",
        out_for_delivery: "Marked out for delivery",
        delivered: "Marked delivered",
      };
      pushToast("ok", toastMsg[action] ?? "Job updated");
      const summaryResponse = await fetch("/api/admin/summary", { credentials: "include" });
      if (summaryResponse.ok) setSummary(await summaryResponse.json());
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
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paid" })
        });
        const body = await response.json().catch(() => ({}));
        return { response, body };
      }));
      const unauthorized = responses.some(({ response }) => response.status === 401);
      if (unauthorized) {
        setLoggedIn(false);
        router.push("/admin");
        return;
      }
      const failed = responses.find(({ response }) => !response.ok);
      if (failed) {
        throw new Error(failed.body.error ?? "Unable to update selected orders.");
      }
      setJobs((prev) => prev.map((job) => {
        const updated = responses.find(({ body }) => body.job?.id === job.id)?.body.job;
        return updated ? { ...job, ...updated } : job;
      }));
      setSelectedJobs(new Set());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to update selected orders.");
    } finally {
      await load();
      setBatchLoading(false);
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

  // "pending_payment" tab also covers the legacy "paid" status value (jobs
  // released before payment was decoupled from print progress).
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
  const activeJobs = jobs.filter((j) => !["printed", "cancelled", "failed"].includes(j.status));

  // Printer trouble signal: there's no ink/paper-level sensor available
  // through the Windows GDI print path, so this watches for the pattern a
  // real supply problem actually produces — several print attempts failing
  // back-to-back — instead of a fake gauge. Counts the leading run of
  // "failed" among the most recent print attempts (chronological, newest
  // first, ignoring jobs that haven't reached a print outcome yet).
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

  if (!loggedIn) {
    return null;
  }

  return (
    <>
      <AdminTopbar
        printerName={printerName}
        newJobCount={newJobCount}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        onRefresh={load}
        onOpenPricing={() => { setShowSettings(true); setShowPrinter(false); setShowManageOrders(false); }}
        onOpenPrinter={() => { setShowPrinter(true); setShowSettings(false); setShowManageOrders(false); }}
        onOpenManageOrders={() => { setShowManageOrders(true); setShowSettings(false); setShowPrinter(false); }}
        onLogout={logout}
        loggingOut={loggingOut}
        staffName={currentStaff?.displayName || currentStaff?.email}
        showPricing={showSettings}
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
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ printerName: name })
            });
            setPrinterName(name);
          }}
          onClose={() => setShowPrinter(false)}
        />
      )}

      {showManageOrders && (
        <ManageOrdersPanel
          jobs={jobs.map((j) => ({
            id: j.id,
            token: j.token,
            status: j.status,
            pricePaise: j.pricePaise,
            createdAt: j.createdAt,
            file: j.file
          }))}
          onClose={() => setShowManageOrders(false)}
          onRefresh={load}
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

      <StatsBar activeJobs={activeJobs.length} todayRevenue={summary.totalPaise} />

      {/* Two distinct filter dimensions (print status, fulfillment method)
          share one row — Status leads on the left since it's the primary
          triage tool, Fulfillment sits at the row's end. Each keeps its own
          caption so the two stay legibly separate; the whole row wraps as
          one unit on narrow screens instead of splitting mid-group. */}
      <div className="admin-filter-row">
        <div className="admin-filter-group">
          <span className="admin-filter-label">Status</span>
          <FilterTabs
            filters={statusFilters}
            activeFilter={filterStatus}
            counts={counts}
            onFilterChange={setFilterStatus}
          />
        </div>

        <div className="admin-filter-group admin-filter-group-end">
          <span className="admin-filter-label">Fulfillment</span>
          <div className="delivery-filter-toggle" role="group" aria-label="Filter by fulfillment method">
            {(["all", "pickup", "delivery"] as const).map((f) => (
              <button
                type="button"
                key={f}
                className={`delivery-filter-btn ${deliveryFilter === f ? "active" : ""}`}
                onClick={() => setDeliveryFilter(f)}
                aria-pressed={deliveryFilter === f}
              >
                {f === "all" ? "All Orders" : f === "pickup" ? "Pickup" : "Delivery"}
                {f === "delivery" && outForDeliveryCount > 0 && (
                  <span className="delivery-filter-count" title={`${outForDeliveryCount} out for delivery`}>
                    <Truck size={12} aria-hidden="true" />
                    {outForDeliveryCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <BatchBar
          selectedCount={selectedJobs.size}
          totalUnpaid={pending.length}
          onSelectAll={selectAll}
          onBatchPaid={batchAction}
          onClear={() => setSelectedJobs(new Set())}
          loading={batchLoading}
        />
      )}

      {actionError && (
        <div className="admin-action-error" role="alert">
          {actionError}
          <button type="button" onClick={() => setActionError("")} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}

      {!jobsLoaded ? (
        <div className="job-list" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="job-skeleton">
              <div className="sk-line w60" />
              <div className="sk-line w40" />
              <div className="sk-line w80" />
            </div>
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          message={filterStatus === "all" ? "Waiting for customer uploads..." : `No ${filterStatus} jobs`}
        />
      ) : (
        <div className="job-list">
          {filteredJobs.map((job, index) => (
            <JobCard
              key={job.id}
              job={job}
              isSelected={selectedJobs.has(job.id)}
              index={index}
              onToggleSelect={() => toggleSelect(job.id)}
              onAction={(action) =>
                action === "cancelled" || action === "delivered"
                  ? setConfirmAction({ action, jobId: job.id })
                  : jobAction(job.id, action)
              }
              onView={() => window.location.href = `/admin/jobs/${job.id}`}
              actionLoading={actionLoading === job.id}
              onNotify={pushToast}
            />
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

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.action === "cancelled" ? "Cancel this job?" : "Mark as delivered?"}
        message={
          confirmAction?.action === "cancelled"
            ? "The job will be cancelled and removed from the active queue. This cannot be undone."
            : "Confirm the order was handed to the customer. This completes the delivery."
        }
        confirmLabel={confirmAction?.action === "cancelled" ? "Cancel job" : "Mark delivered"}
        danger={confirmAction?.action === "cancelled"}
        onConfirm={() => {
          const pendingConfirm = confirmAction;
          setConfirmAction(null);
          if (pendingConfirm) jobAction(pendingConfirm.jobId, pendingConfirm.action);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      <ToastStack toasts={toasts} />
      </main>
    </>
  );
}
