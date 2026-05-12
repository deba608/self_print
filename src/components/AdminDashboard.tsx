"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import {
  RefreshCw, Settings, LogOut, Printer, Bell,
  CheckSquare, Square, CreditCard, Eye, X, Check, Monitor, Loader2
} from "lucide-react";

type Job = {
  id: string;
  token: string;
  status: string;
  pricePaise: number;
  createdAt: string;
  needsConversion: 0 | 1;
  queuePosition: number;
  expiresAt: string;
  printType: string;
  paperSize: string;
  copies: number;
  file: { originalName: string };
};

type Pricing = {
  bwPerPagePaise: number;
  colorPerPagePaise: number;
  photoPrintPaise: number;
  copyMultiplier: number;
  a3Multiplier: number;
  a4Multiplier: number;
  a5Multiplier: number;
  a6Multiplier: number;
  b5Multiplier: number;
  legalMultiplier: number;
  photoMultiplier: number;
  expiryMinutes: number;
};

type PrinterOption = {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
};

export default function AdminDashboard() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [summary, setSummary] = useState({ jobs: 0, totalPaise: 0 });
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pricingForm, setPricingForm] = useState<Pricing | null>(null);
  const [pricingSaved, setPricingSaved] = useState(false);
  const [newJobCount, setNewJobCount] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [printerName, setPrinterName] = useState("");
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [printerSaved, setPrinterSaved] = useState(false);
  const [showPrinter, setShowPrinter] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/jobs");
    if (response.status === 401) { setLoggedIn(false); return; }
    const body = await response.json();
    const jobsWithExpiry = (body.jobs ?? []).map((j: Job) => ({
      ...j,
      expiresAt: j.expiresAt || new Date(new Date(j.createdAt).getTime() + (body.expiryMinutes || 1440) * 60000).toISOString()
    }));
    setJobs(jobsWithExpiry);
    setNewJobCount(0);
    setLoggedIn(true);
    const summaryResponse = await fetch("/api/admin/summary");
    setSummary(await summaryResponse.json());
    loadPricing();
    loadPrinter();
  }, []);

  async function loadPricing() {
    const res = await fetch("/api/admin/pricing");
    const data = await res.json();
    setPricing(data);
    setPricingForm(data);
  }

  async function loadPrinter() {
    const res = await fetch("/api/admin/printer");
    const data = await res.json();
    setPrinterName(data.printerName || "");
    const printersRes = await fetch("/api/admin/printers");
    if (printersRes.ok) {
      const printersData = await printersRes.json();
      setPrinters(printersData.printers ?? []);
    }
  }

  async function connectSSE() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("/api/admin/notifications");
    es.onmessage = () => { setNewJobCount((n) => n + 1); load(); };
    es.onopen = () => setSseConnected(true);
    es.onerror = () => { setSseConnected(false); setTimeout(connectSSE, 5000); };
    esRef.current = es;
  }

  useEffect(() => {
    if (loggedIn) {
      connectSSE();
      const interval = setInterval(() => setNow(Date.now()), 30000);
      return () => { clearInterval(interval); if (esRef.current) esRef.current.close(); };
    }
  }, [loggedIn]);

  useEffect(() => { load(); }, [load]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) { setError("Invalid login"); return; }
    await load();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setLoggedIn(false);
  }

  async function savePricing() {
    if (!pricingForm) return;
    const response = await fetch("/api/admin/pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pricingForm)
    });
    if (response.ok) { setPricing(pricingForm); setPricingSaved(true); setShowSettings(false); setTimeout(() => setPricingSaved(false), 2000); }
  }

  async function savePrinter() {
    const response = await fetch("/api/admin/printer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printerName })
    });
    if (response.ok) {
      setPrinterSaved(true);
      setTimeout(() => setPrinterSaved(false), 2000);
      setShowPrinter(false);
    }
  }

  async function choosePrinter(name: string) {
    setPrinterName(name);
    const response = await fetch("/api/admin/printer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printerName: name })
    });
    if (response.ok) {
      setPrinterSaved(true);
      setTimeout(() => setPrinterSaved(false), 2000);
      setShowPrinter(false);
    }
  }

  async function jobAction(jobId: string, action: "paid" | "approved" | "printed" | "cancelled") {
    setActionLoading(jobId);
    try {
      await fetch(`/api/admin/jobs/${jobId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action })
      });
    } finally {
      setActionLoading(null);
      await load();
    }
  }

  async function batchAction(action: "paid" | "approved") {
    const ids = Array.from(selectedJobs);
    await Promise.all(ids.map((id) =>
      fetch(`/api/admin/jobs/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action })
      })
    ));
    setSelectedJobs(new Set());
    await load();
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedJobs);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedJobs(next);
  }

  function selectAll() {
    const pending = filteredJobs.filter((j) => j.status === "pending_payment").map((j) => j.id);
    setSelectedJobs(selectedJobs.size === pending.length ? new Set() : new Set(pending));
  }

  function expiryLabel(expiresAt: string) {
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) return { text: "Expired", urgent: true, expired: true };
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return { text: `${mins}m left`, urgent: mins < 10, expired: false };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return { text: `${hrs}h ${mins % 60}m`, urgent: false, expired: false };
    return { text: `${Math.floor(hrs / 24)}d left`, urgent: false, expired: false };
  }

  function statusBadge(status: string) {
    const map: Record<string, { label: string; cls: string }> = {
      pending_payment: { label: "Unpaid", cls: "warn" },
      paid: { label: "Paid", cls: "info" },
      approved: { label: "Ready", cls: "ready" },
      printing: { label: "Printing", cls: "info" },
      printed: { label: "Done", cls: "ok" },
      failed: { label: "Failed", cls: "danger" },
      cancelled: { label: "Cancelled", cls: "danger" },
    };
    return map[status] ?? { label: status, cls: "" };
  }

  function formatRupees(paise: number) {
    return `₹${(paise / 100).toFixed(2)}`;
  }

  const filteredJobs = filterStatus === "all" ? jobs : jobs.filter((j) => j.status === filterStatus);
  const pending = jobs.filter((j) => j.status === "pending_payment");
  const activeJobs = jobs.filter((j) => !["printed", "cancelled", "failed"].includes(j.status));

  const statusFilters = [
    { value: "all", label: "All" },
    { value: "pending_payment", label: "Unpaid" },
    { value: "paid", label: "Paid" },
    { value: "approved", label: "Ready" },
    { value: "printing", label: "Printing" },
    { value: "printed", label: "Done" },
  ];

  if (!loggedIn) {
    return (
      <main className="customer-shell">
        <section className="panel stack">
          <div className="admin-login-header">
            <Printer size={36} className="admin-logo" />
            <h1>SelfPrint Admin</h1>
          </div>
          <form className="stack" onSubmit={login}>
            <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit">Login</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      {/* Top bar */}
      <header className="admin-topbar">
        {/* Brand */}
        <div className="admin-brand">
          <Printer size={24} />
          <span>Self_Print</span>
        </div>

        {/* Stats */}
        <div className="admin-stats">
          <div className="stat-chip">
            <span className="stat-label">Active</span>
            <span className="stat-value">{activeJobs.length}</span>
          </div>
          <div className="stat-chip revenue-chip">
            <span className="stat-label">₹ Today</span>
            <span className="stat-value">{formatRupees(summary.totalPaise)}</span>
          </div>
        </div>

        {/* Active printer */}
        <button
          className={`printer-chip ${printerName ? "active-printer" : "no-printer"}`}
          onClick={() => { setShowPrinter(true); setShowSettings(false); }}
          title="Click to change printer"
        >
          <Monitor size={16} />
          <span className="printer-chip-label">
            {printerName ? printerName : "No printer"}
          </span>
          {printerName && <span className="printer-active-dot" />}
        </button>

        {/* Actions */}
        <div className="admin-actions">
          {newJobCount > 0 && (
            <button className="notif-btn" onClick={load}>
              <Bell size={15} />
              <span>{newJobCount} new</span>
            </button>
          )}
          <button className="admin-action-btn" onClick={load} title="Refresh job list">
            <RefreshCw size={18} />
            <span>Refresh</span>
          </button>
          <button
            className={`admin-action-btn ${showSettings ? "active" : ""}`}
            onClick={() => { setShowSettings(!showSettings); setShowPrinter(false); }}
          >
            <span className="rupee-icon">₹</span>
            <span>Pricing</span>
          </button>
          <button className="admin-action-btn admin-action-danger" onClick={logout}>
            <LogOut size={18} />
            <span>Logout</span>
          </button>
          <span className={`sse-dot ${sseConnected ? "connected" : ""}`} title={sseConnected ? "Live updates connected" : "Connecting..."} />
        </div>
      </header>

      {/* Printer panel */}
      {showPrinter && (
        <section className="admin-panel printer-dropdown-panel">
          <div className="panel-header">
            <Monitor size={18} />
            <h3>Select Printer</h3>
            <button className="panel-close-btn" onClick={() => setShowPrinter(false)} aria-label="Close printer menu">
              <X size={14} />
            </button>
          </div>
          {printers.length > 0 ? (
            <div className="printer-list">
              <div className="printer-options">
                {printers.map((printer) => (
                  <button
                    key={printer.name}
                    type="button"
                    className={`printer-option ${printerName === printer.name ? "selected" : ""}`}
                    onClick={() => choosePrinter(printer.name)}
                  >
                    <div className="printer-option-content">
                      <span className="printer-name">{printer.name}</span>
                      <span className="printer-driver">{printer.driverName}</span>
                    </div>
                    {printer.isDefault && <span className="default-badge">Default</span>}
                    {printerName === printer.name && <Check size={15} className="printer-selected-check" />}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="printer-empty">
              <Printer size={28} />
              <p>No printers detected</p>
              <span>Make sure the print agent is running on the shop PC</span>
            </div>
          )}
          <div className="panel-actions">
            <button className="btn-primary-sm" onClick={savePrinter} disabled={!printerName || printers.length > 0}>
              {printerSaved ? <><Check size={14} /> Saved</> : "Save manual printer"}
            </button>
            {printerSaved && <span className="saved-msg"><Check size={14} /> Saved</span>}
          </div>
        </section>
      )}

      {/* Settings panel */}
      {showSettings && pricingForm && (
        <section className="admin-panel">
          <div className="panel-header">
            <span className="rupee-icon panel-rupee-icon">₹</span>
            <h3>Pricing & Settings</h3>
            <button className="panel-close-btn" onClick={() => setShowSettings(false)} aria-label="Close settings">
              <X size={14} />
            </button>
          </div>
          <div className="pricing-grid">
            <label>
              <span>B/W per page (₹)</span>
              <input type="number" min="0" step="0.01" value={pricingForm.bwPerPagePaise / 100}
                onChange={(e) => setPricingForm({ ...pricingForm, bwPerPagePaise: Math.round((Number(e.target.value) || 0) * 100) })} />
            </label>
            <label>
              <span>Color per page (₹)</span>
              <input type="number" min="0" step="0.01" value={pricingForm.colorPerPagePaise / 100}
                onChange={(e) => setPricingForm({ ...pricingForm, colorPerPagePaise: Math.round((Number(e.target.value) || 0) * 100) })} />
            </label>
            <label>
              <span>Photo print (₹)</span>
              <input type="number" min="0" step="0.01" value={pricingForm.photoPrintPaise / 100}
                onChange={(e) => setPricingForm({ ...pricingForm, photoPrintPaise: Math.round((Number(e.target.value) || 0) * 100) })} />
            </label>
            <label>
              <span>Copy multiplier</span>
              <input type="number" min="0" step="0.1" value={pricingForm.copyMultiplier}
                onChange={(e) => setPricingForm({ ...pricingForm, copyMultiplier: Number(e.target.value) })} />
            </label>
            <label>
              <span>A3 multiplier</span>
              <input type="number" min="0" step="0.1" value={pricingForm.a3Multiplier}
                onChange={(e) => setPricingForm({ ...pricingForm, a3Multiplier: Number(e.target.value) })} />
            </label>
            <label>
              <span>A5 multiplier</span>
              <input type="number" min="0" step="0.1" value={pricingForm.a5Multiplier}
                onChange={(e) => setPricingForm({ ...pricingForm, a5Multiplier: Number(e.target.value) })} />
            </label>
            <label>
              <span>Legal multiplier</span>
              <input type="number" min="0" step="0.1" value={pricingForm.legalMultiplier}
                onChange={(e) => setPricingForm({ ...pricingForm, legalMultiplier: Number(e.target.value) })} />
            </label>
            <label>
              <span>Job expiry (min)</span>
              <input type="number" min="30" step="10" value={pricingForm.expiryMinutes}
                onChange={(e) => setPricingForm({ ...pricingForm, expiryMinutes: Number(e.target.value) })} />
            </label>
          </div>
          <div className="panel-actions">
            <button className="btn-primary-sm" onClick={savePricing}>Save</button>
            {pricingSaved && <span className="saved-msg"><Check size={14} /> Saved</span>}
          </div>
        </section>
      )}

      {/* Filter tabs */}
      <div className="filter-bar">
        {statusFilters.map((f) => {
          const count = f.value === "all" ? jobs.length : jobs.filter((j) => j.status === f.value).length;
          return (
            <button key={f.value} className={`filter-tab ${filterStatus === f.value ? "active" : ""}`} onClick={() => setFilterStatus(f.value)}>
              {f.label} <span className="filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Batch actions */}
      {pending.length > 0 && (
        <div className="batch-bar">
          <span className="batch-info">
            <button className="select-all-btn" onClick={selectAll}>
              {selectedJobs.size === pending.length ? <CheckSquare size={15} /> : <Square size={15} />}
              {selectedJobs.size > 0 ? `${selectedJobs.size} selected` : "Select all unpaid"}
            </button>
          </span>
          {selectedJobs.size > 0 && (
            <div className="batch-actions">
              <button className="batch-btn-paid" onClick={() => batchAction("paid")}>
                <CreditCard size={15} /> Mark paid
              </button>
              <button className="batch-btn-clear" onClick={() => setSelectedJobs(new Set())}>
                <X size={15} /> Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* Job list */}
      <div className="job-list">
        {filteredJobs.length === 0 ? (
          <div className="empty-state">
            <Printer size={40} />
            <p>No jobs found</p>
            <span>{filterStatus === "all" ? "Waiting for customer uploads..." : `No ${filterStatus} jobs`}</span>
          </div>
        ) : filteredJobs.map((job) => {
          const badge = statusBadge(job.status);
          const expiry = expiryLabel(job.expiresAt);
          const busy = actionLoading === job.id;

          return (
            <div key={job.id} className="job-card">
              {/* Main row: info + actions inline */}
              <div className="job-card-main">
                {job.status === "pending_payment" && (
                  <input type="checkbox" className="job-check"
                    checked={selectedJobs.has(job.id)} onChange={(e) => { e.stopPropagation(); toggleSelect(job.id); }} />
                )}
                <span className="queue-badge">#{job.queuePosition}</span>
                <div className="job-card-body">
                  <div className="job-card-top">
                    <span className="job-token">Token {job.token}</span>
                    <span className={`status-badge ${badge.cls}`}>{badge.label}</span>
                    {!["printed", "cancelled", "failed"].includes(job.status) && (
                      <span className={`expiry-chip ${expiry.expired ? "expired" : expiry.urgent ? "urgent" : ""}`}>
                        {expiry.text}
                      </span>
                    )}
                  </div>
                  <div className="job-card-info">
                    <span className="job-filename">{job.file.originalName}</span>
                    <span className="job-sep">·</span>
                    <span className="job-details">{job.printType === "bw" ? "B&W" : "Color"}</span>
                    <span className="job-sep">·</span>
                    <span className="job-details">{job.copies} copy</span>
                    <span className="job-sep">·</span>
                    <span className="job-details">{job.paperSize}</span>
                    <span className="job-sep">·</span>
                    <span className="job-time">{new Date(job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
                <div className="job-card-actions-inline">
                  {job.status === "pending_payment" && (
                    <button className="job-action-btn job-action-paid" disabled={busy} onClick={() => jobAction(job.id, "paid")}>
                      {busy ? <Loader2 size={13} className="spin" /> : <CreditCard size={13} />}
                      <span>Mark Paid</span>
                    </button>
                  )}
                  {job.status === "paid" && (
                    <button className="job-action-btn job-action-release" disabled={busy} onClick={() => jobAction(job.id, "approved")}>
                      {busy ? <Loader2 size={13} className="spin" /> : <Printer size={13} />}
                      <span>Release</span>
                    </button>
                  )}
                  {(job.status === "approved" || job.status === "printing") && (
                    <button className="job-action-btn job-action-done" disabled={busy} onClick={() => jobAction(job.id, "printed")}>
                      {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                      <span>Done</span>
                    </button>
                  )}
                  {job.status === "printed" && (
                    <button className="job-action-btn job-action-reprint" disabled={busy} onClick={() => jobAction(job.id, "approved")}>
                      {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
                      <span>Reprint</span>
                    </button>
                  )}
                  {!["printed", "cancelled", "failed"].includes(job.status) && (
                    <button className="job-action-btn job-action-cancel" disabled={busy} onClick={() => jobAction(job.id, "cancelled")}>
                      <X size={13} />
                    </button>
                  )}
                  <Link href={`/admin/jobs/${job.id}`} className="job-action-btn job-action-view">
                    <Eye size={13} />
                  </Link>
                </div>
                <div className="job-card-right">
                  <strong className="job-price">{formatRupees(job.pricePaise)}</strong>
                </div>
              </div>

              {/* Conversion warning */}
              {job.needsConversion === 1 && (
                <div className="job-card-footer">
                  <span className="conversion-note">
                    ⚠ This DOC/DOCX file needs conversion before printing — use the job detail page to convert it first.
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
