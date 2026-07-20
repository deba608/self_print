"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  RefreshCw, Settings, LogOut, Printer, Bell, BellRing,
  CheckSquare, Square, CreditCard, Eye, X, Check, Monitor, Loader2,
  Lock, Eye as EyeIcon, EyeOff, ChevronDown, Zap, TrendingUp, Clock,
  Trash2, ListTodo, Inbox, FileText, BarChart2, ShieldCheck, User, ArrowRight, MessageCircleWarning
} from "lucide-react";
import { manualPrint } from "@/lib/manualPrint";
import Link from "next/link";

type Job = {
  id: string;
  token: string;
  status: string;
  pricePaise: number;
  createdAt: string;
  needsConversion: 0 | 1;
  queuePosition: number;
  printType: string;
  paperSize: string;
  copies: number;
  paidAt?: string | null;
  issueReportedAt?: string | null;
  issueNote?: string | null;
  issueResolvedAt?: string | null;
  file: { originalName: string } | null;
  fileCount?: number;
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
  duplexBwPerPagePaise: number;
  expiryMinutes: number;
};

type PricingDraft = {
  [Key in keyof Pricing]: Pricing[Key] | "";
};

type PrinterOption = {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
};

const defaultPricing: Pricing = {
  bwPerPagePaise: 200,
  colorPerPagePaise: 800,
  photoPrintPaise: 1000,
  copyMultiplier: 1,
  a3Multiplier: 2,
  a4Multiplier: 1,
  a5Multiplier: 0.75,
  a6Multiplier: 0.5,
  b5Multiplier: 0.9,
  legalMultiplier: 1.25,
  photoMultiplier: 1.5,
  duplexBwPerPagePaise: 100,
  expiryMinutes: 1440,
};

function normalizePricingDraft(draft: PricingDraft): Pricing | null {
  const entries = Object.entries(draft) as Array<[keyof Pricing, number | ""]>;
  if (entries.some(([, value]) => value === "" || !Number.isFinite(value))) {
    return null;
  }

  return Object.fromEntries(entries) as Pricing;
}

function formatPaiseInput(value: number | "") {
  return value === "" ? "" : String(value / 100);
}

// Login Component
function AdminLogin({ onLogin }: { onLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please enter username and password");
      return;
    }
    setLoading(true);
    setError("");
    const result = await onLogin(username, password);
    if (!result.success) {
      setError(result.error || "Invalid credentials");
    }
    setLoading(false);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">
            <Printer size={32} strokeWidth={1.5} />
          </div>
          <h1>SelfPrint Admin</h1>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="username">Username</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <User size={18} strokeWidth={2} />
              </span>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                disabled={loading}
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <Lock size={18} strokeWidth={2} />
              </span>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <EyeIcon size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="login-error">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
              {error}
            </div>
          )}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={18} className="spin" />
                Signing in...
              </>
            ) : (
              <>
                <span>Sign In</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// Stats Cards Component
// Animates a numeric value toward its target over ~450ms so stat changes
// count up/down instead of jumping.
function useCountUp(target: number): number {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const dur = 450;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (target - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); fromRef.current = target; };
  }, [target]);
  return display;
}

function StatsBar({ activeJobs, todayRevenue }: { activeJobs: number; todayRevenue: number }) {
  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  const animatedJobs = useCountUp(activeJobs);
  const animatedRevenue = useCountUp(todayRevenue);

  return (
    <div className="stats-bar">
      <div className="stat-card">
        <div className="stat-icon active">
          <Inbox size={20} />
        </div>
        <div className="stat-content">
          <span className="stat-label">Active Jobs</span>
          <span className="stat-value">{Math.round(animatedJobs)}</span>
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-icon revenue">
          <TrendingUp size={20} />
        </div>
        <div className="stat-content">
          <span className="stat-label">Today&apos;s Revenue</span>
          <span className="stat-value">{formatRupees(animatedRevenue)}</span>
        </div>
      </div>
    </div>
  );
}

// Topbar Component
function AdminTopbar({
  printerName,
  newJobCount,
  soundOn,
  onToggleSound,
  onRefresh,
  onOpenPricing,
  onOpenPrinter,
  onOpenManageOrders,
  onLogout,
  showPricing
}: {
  printerName: string;
  newJobCount: number;
  soundOn: boolean;
  onToggleSound: () => void;
  onRefresh: () => void;
  onOpenPricing: () => void;
  onOpenPrinter: () => void;
  onOpenManageOrders: () => void;
  onLogout: () => void;
  showPricing: boolean;
}) {
  return (
    <header className="admin-topbar">
      <div className="admin-topbar-inner">
      <div className="topbar-brand">
        <div className="brand-logo">
          <Printer size={24} strokeWidth={1.5} />
        </div>
        <div className="brand-text">
          <span className="brand-name">SelfPrint</span>
          <span className="brand-tag">Admin</span>
        </div>
      </div>

      <button
        className={`printer-btn ${printerName ? "active" : "empty"}`}
        onClick={onOpenPrinter}
        type="button"
        aria-label={printerName ? `Selected printer ${printerName}` : "Select printer"}
      >
        <Monitor size={18} />
        <span className="printer-label">{printerName || "Select Printer"}</span>
        {printerName && <span className="printer-dot"></span>}
        <ChevronDown size={16} className="chevron" />
      </button>

      <div className="topbar-actions">
        <div className="action-group">
          <button
            type="button"
            className={`action-btn notification ${soundOn ? "chime-on" : ""} ${newJobCount > 0 ? "has-new" : ""}`}
            onClick={() => {
              if (newJobCount > 0) onRefresh();
              onToggleSound();
            }}
            title={`Notifications: ${newJobCount} new orders. Chime alert is ${soundOn ? "ON" : "OFF"}. Click to ${newJobCount > 0 ? "refresh & " : ""}toggle chime sound.`}
            aria-label="Notifications and chime alert settings"
          >
            {soundOn ? <BellRing size={18} className="bell-ring-icon" /> : <Bell size={18} />}
            {newJobCount > 0 && (
              <span className="notif-badge">{newJobCount}</span>
            )}
            {soundOn && <span className="chime-dot" title="New-order chime active"></span>}
          </button>

          <button type="button" className="action-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh jobs">
            <RefreshCw size={18} />
          </button>

          <button
            type="button"
            className="action-btn"
            onClick={onOpenManageOrders}
            title="Manage Orders"
            aria-label="Manage orders"
          >
            <ListTodo size={18} />
          </button>

          <Link
            href="/admin/accounts"
            className="action-btn"
            title="Accounts & Daily Data"
            aria-label="Accounts and daily data"
          >
            <BarChart2 size={18} />
          </Link>

          <button
            type="button"
            className={`action-btn ${showPricing ? "active" : ""}`}
            onClick={onOpenPricing}
            title="Pricing Settings"
            aria-label="Pricing settings"
          >
            <Settings size={18} />
          </button>
        </div>

        <div className="topbar-divider" aria-hidden="true" />

        <div className="action-group">
          <button type="button" className="action-btn danger" onClick={onLogout} title="Logout" aria-label="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>
      </div>
    </header>
  );
}

// Pricing Panel Component
function PricingPanel({
  pricing,
  onSave,
  onClose
}: {
  pricing: Pricing | null;
  onSave: (data: Pricing) => Promise<void>;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<PricingDraft>(pricing || defaultPricing);
  const [priceInputs, setPriceInputs] = useState({
    bwPerPagePaise: formatPaiseInput((pricing || defaultPricing).bwPerPagePaise),
    colorPerPagePaise: formatPaiseInput((pricing || defaultPricing).colorPerPagePaise),
    photoPrintPaise: formatPaiseInput((pricing || defaultPricing).photoPrintPaise),
    duplexBwPerPagePaise: formatPaiseInput((pricing || defaultPricing).duplexBwPerPagePaise),
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const nextPricing = pricing || defaultPricing;
    setFormData(nextPricing);
    setPriceInputs({
      bwPerPagePaise: formatPaiseInput(nextPricing.bwPerPagePaise),
      colorPerPagePaise: formatPaiseInput(nextPricing.colorPerPagePaise),
      photoPrintPaise: formatPaiseInput(nextPricing.photoPrintPaise),
      duplexBwPerPagePaise: formatPaiseInput(nextPricing.duplexBwPerPagePaise),
    });
  }, [pricing]);

  const updateField = (field: keyof Pricing, value: string, transform: (value: string) => number = Number) => {
    if (value === "") {
      setFormData(prev => ({ ...prev, [field]: "" }));
    } else {
      const num = transform(value);
      setFormData(prev => ({ ...prev, [field]: num }));
    }
    setSaved(false);
    setError("");
  };

  const updatePriceField = (field: "bwPerPagePaise" | "colorPerPagePaise" | "photoPrintPaise" | "duplexBwPerPagePaise", rawValue: string) => {
    setPriceInputs(prev => ({ ...prev, [field]: rawValue }));
    if (rawValue === "") {
      setFormData(prev => ({ ...prev, [field]: "" }));
    } else {
      const num = Number(rawValue);
      setFormData(prev => ({ ...prev, [field]: Number.isFinite(num) ? Math.round(num * 100) : "" }));
    }
    setSaved(false);
    setError("");
  };

  const handleSave = async () => {
    const nextPricing = normalizePricingDraft(formData);
    if (!nextPricing) {
      setError("Fill every pricing value before saving.");
      return;
    }

    setSaving(true);
    try {
      await onSave(nextPricing);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save pricing.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="pricing-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Zap size={20} className="panel-icon" />
            <h2>Pricing Settings</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="pricing-sections">
          <section className="pricing-section">
            <h3>Base Print Prices</h3>
            <div className="pricing-grid">
              <div className="pricing-field">
                <label>B&amp;W per page</label>
                <div className="price-input">
                  <span className="currency">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs.bwPerPagePaise}
                    onChange={(e) => updatePriceField("bwPerPagePaise", e.target.value)}
                  />
                </div>
              </div>
              <div className="pricing-field">
                <label>Color per page</label>
                <div className="price-input">
                  <span className="currency">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs.colorPerPagePaise}
                    onChange={(e) => updatePriceField("colorPerPagePaise", e.target.value)}
                  />
                </div>
              </div>
              <div className="pricing-field">
                <label>Photo print</label>
                <div className="price-input">
                  <span className="currency">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs.photoPrintPaise}
                    onChange={(e) => updatePriceField("photoPrintPaise", e.target.value)}
                  />
                </div>
              </div>
              <div className="pricing-field">
                <label>Double-sided B&amp;W per page</label>
                <div className="price-input">
                  <span className="currency">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs.duplexBwPerPagePaise}
                    onChange={(e) => updatePriceField("duplexBwPerPagePaise", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="pricing-section">
            <h3>Multipliers</h3>
            <div className="pricing-grid">
              <div className="pricing-field">
                <label>Copy multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.copyMultiplier}
                  onChange={(e) => updateField("copyMultiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>A3 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.a3Multiplier}
                  onChange={(e) => updateField("a3Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>A4 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.a4Multiplier}
                  onChange={(e) => updateField("a4Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>A5 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.a5Multiplier}
                  onChange={(e) => updateField("a5Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>Legal multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.legalMultiplier}
                  onChange={(e) => updateField("legalMultiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>A6 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.a6Multiplier}
                  onChange={(e) => updateField("a6Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>B5 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.b5Multiplier}
                  onChange={(e) => updateField("b5Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>Photo multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.photoMultiplier}
                  onChange={(e) => updateField("photoMultiplier", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="pricing-section">
            <h3>Job Expiry</h3>
            <div className="pricing-grid single">
              <div className="pricing-field">
                <label>Expire unpaid jobs after</label>
                <div className="time-input">
                  <Clock size={16} className="time-icon" />
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={formData.expiryMinutes}
                    onChange={(e) => updateField("expiryMinutes", e.target.value, (v) => Math.round(Number(v)))}
                  />
                  <span className="time-hint">min</span>
                </div>
                <span className="pricing-hint">
                  {typeof formData.expiryMinutes === "number" && formData.expiryMinutes > 0
                    ? `${(formData.expiryMinutes / 60).toFixed(1)} hours before an unpaid, unreleased job is removed from the queue`
                    : ""}
                </span>
              </div>
            </div>
          </section>
        </div>

        {error && <p className="panel-error" role="alert">{error}</p>}

        <div className="panel-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saved || saving}>
            {saving ? (
              <>
                <Loader2 size={18} className="spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <Check size={18} />
                Saved!
              </>
            ) : (
              <>
                Save Changes
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Printer Panel Component
function PrinterPanel({
  printers,
  selectedPrinter,
  onSelect,
  onClose
}: {
  printers: PrinterOption[];
  selectedPrinter: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const [manualPrinter, setManualPrinter] = useState(selectedPrinter);

  const saveManualPrinter = () => {
    const printerName = manualPrinter.trim();
    if (!printerName) return;
    onSelect(printerName);
    onClose();
  };

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="printer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Monitor size={20} className="panel-icon" />
            <h2>Select Printer</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="printer-list">
          {printers.length === 0 ? (
            <>
              <div className="printer-empty">
                <Printer size={40} strokeWidth={1} />
                <p>No printers detected</p>
                <span>Make sure the print agent is running on the shop computer.</span>
              </div>
              <div className="manual-printer-entry">
                <label htmlFor="manual-printer">Set printer name manually</label>
                <div className="manual-printer-row">
                  <input
                    id="manual-printer"
                    value={manualPrinter}
                    onChange={(event) => setManualPrinter(event.target.value)}
                    placeholder="Example: HP LaserJet Pro"
                  />
                  <button type="button" onClick={saveManualPrinter} disabled={!manualPrinter.trim()}>
                    Set
                  </button>
                </div>
              </div>
            </>
          ) : (
            printers.map((printer) => (
              <button
                type="button"
                key={printer.name}
                className={`printer-item ${selectedPrinter === printer.name ? "selected" : ""}`}
                onClick={() => {
                  onSelect(printer.name);
                  onClose();
                }}
              >
                <div className="printer-icon">
                  <Printer size={20} />
                </div>
                <div className="printer-info">
                  <span className="printer-name">{printer.name}</span>
                  <span className="printer-driver">{printer.driverName}</span>
                </div>
                {printer.isDefault && <span className="default-tag">Default</span>}
                {selectedPrinter === printer.name && (
                  <div className="printer-check">
                    <Check size={16} />
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Manage Orders Panel Component
type ManageJob = {
  id: string;
  token: string;
  status: string;
  pricePaise: number;
  createdAt: string;
  file: { originalName: string } | null;
};

function ManageOrdersPanel({
  jobs,
  onClose,
  onRefresh
}: {
  jobs: ManageJob[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());

  const filteredJobs = filterStatus === "all" ? jobs : jobs.filter((j) => j.status === filterStatus);

  const statusCounts = jobs.reduce((acc, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

  const statusLabels: Record<string, string> = {
    pending_payment: "Unpaid",
    paid: "Paid",
    approved: "Ready",
    printing: "Printing",
    printed: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  };

  async function deleteJob(jobId: string) {
    setDeleteLoading(jobId);
    try {
      const response = await fetch(`/api/admin/jobs/${jobId}`, { method: "DELETE", credentials: "include" });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (response.ok) {
        setConfirmDelete(null);
        setLeavingIds((prev) => new Set(prev).add(jobId));
        setTimeout(() => {
          onRefresh();
          setLeavingIds((prev) => { const next = new Set(prev); next.delete(jobId); return next; });
        }, 260);
      }
    } finally {
      setDeleteLoading(null);
    }
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const response = await fetch("/api/admin/jobs/bulk-delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      if (response.status === 401) {
        window.location.reload();
        return;
      }
      if (response.ok) {
        setSelectedIds(new Set());
        setConfirmBulkDelete(false);
        setLeavingIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
        setTimeout(() => {
          onRefresh();
          setLeavingIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
        }, 260);
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function selectAll() {
    const allIds = filteredJobs.map((j) => j.id);
    const allSelected = selectedIds.size === allIds.length && allIds.length > 0;
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="manage-orders-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <ListTodo size={20} className="panel-icon" />
            <h2>Manage Orders</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="manage-orders-filters">
          <button
            type="button"
            className={`manage-filter-tab ${filterStatus === "all" ? "active" : ""}`}
            onClick={() => setFilterStatus("all")}
          >
            All <span className="manage-filter-count">{jobs.length}</span>
          </button>
          {Object.entries(statusLabels).map(([status, label]) => (
            statusCounts[status] > 0 && (
              <button
                type="button"
                key={status}
                className={`manage-filter-tab ${filterStatus === status ? "active" : ""}`}
                onClick={() => setFilterStatus(status)}
              >
                {label} <span className="manage-filter-count">{statusCounts[status]}</span>
              </button>
            )
          ))}
        </div>

        {selectedIds.size > 0 && (
          <div className="manage-bulk-bar">
            <span>{selectedIds.size} selected</span>
            <div className="manage-bulk-actions">
              <button
                type="button"
                className="bulk-delete-btn"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                Delete Selected
              </button>
              <button type="button" className="bulk-clear-btn" onClick={() => setSelectedIds(new Set())}>
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="manage-orders-list">
          <button type="button" className="manage-select-all" onClick={selectAll}>
            {selectedIds.size === filteredJobs.length && filteredJobs.length > 0 ? (
              <CheckSquare size={16} />
            ) : (
              <Square size={16} />
            )}
            <span>Select all ({filteredJobs.length})</span>
          </button>

          {filteredJobs.length === 0 ? (
            <div className="manage-empty">
              <Printer size={32} strokeWidth={1} />
              <p>No orders found</p>
            </div>
          ) : (
            filteredJobs.map((job) => (
              <div key={job.id} className={`manage-order-item ${leavingIds.has(job.id) ? "leaving" : ""}`}>
                <button
                  className={`manage-order-checkbox ${selectedIds.has(job.id) ? "selected" : ""}`}
                  onClick={() => toggleSelect(job.id)}
                  type="button"
                >
                  <span className={`checkbox-circle checkbox-circle-sm ${selectedIds.has(job.id) ? "checked" : ""}`}>
                    {selectedIds.has(job.id) && <Check size={12} strokeWidth={3.5} />}
                  </span>
                </button>
                <div className="manage-order-info">
                  <div className="manage-order-header">
                    <span className="manage-order-token">Token {job.token}</span>
                    <span className="manage-order-status">{statusLabels[job.status] || job.status}</span>
                  </div>
                  <div className="manage-order-details">
                    <span className="manage-order-file">{job.file?.originalName || "No file"}</span>
                    <span className="manage-order-price">{formatRupees(job.pricePaise)}</span>
                  </div>
                  <div className="manage-order-time">
                    {new Date(job.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="manage-order-delete"
                  onClick={() => setConfirmDelete(job.id)}
                  disabled={deleteLoading === job.id}
                  aria-label="Delete order"
                >
                  {deleteLoading === job.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                </button>

                {confirmDelete === job.id && (
                  <div className="manage-delete-confirm">
                    <p>Delete this order permanently?</p>
                    <div className="manage-confirm-actions">
                      <button type="button" onClick={() => setConfirmDelete(null)}>Cancel</button>
                      <button type="button" className="confirm-delete" onClick={() => deleteJob(job.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {confirmBulkDelete && (
          <div className="manage-bulk-confirm-overlay" onClick={() => setConfirmBulkDelete(false)}>
            <div className="manage-bulk-confirm" onClick={(e) => e.stopPropagation()}>
              <Trash2 size={32} className="confirm-icon" />
              <h3>Delete {selectedIds.size} orders?</h3>
              <p>This action cannot be undone. All files and records will be permanently removed.</p>
              <div className="confirm-actions">
                <button type="button" onClick={() => setConfirmBulkDelete(false)}>Cancel</button>
                <button type="button" className="confirm-delete" onClick={bulkDelete} disabled={bulkDeleting}>
                  {bulkDeleting ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      Delete All
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Filter Tabs Component
function FilterTabs({
  filters,
  activeFilter,
  counts,
  onFilterChange
}: {
  filters: { value: string; label: string }[];
  activeFilter: string;
  counts: Record<string, number>;
  onFilterChange: (filter: string) => void;
}) {
  return (
    <div className="filter-bar">
      {filters.map((filter) => (
        <button
          type="button"
          key={filter.value}
          className={`filter-tab ${activeFilter === filter.value ? "active" : ""}`}
          onClick={() => onFilterChange(filter.value)}
        >
          {filter.label}
          <span className="filter-count">{counts[filter.value] || 0}</span>
        </button>
      ))}
    </div>
  );
}

// Batch Bar Component
function BatchBar({
  selectedCount,
  totalUnpaid,
  onSelectAll,
  onBatchPaid,
  onClear
}: {
  selectedCount: number;
  totalUnpaid: number;
  onSelectAll: () => void;
  onBatchPaid: () => void;
  onClear: () => void;
}) {
  const allSelected = selectedCount === totalUnpaid && totalUnpaid > 0;

  return (
    <div className="batch-bar">
      <button type="button" className="select-btn" onClick={onSelectAll}>
        {allSelected ? <CheckSquare size={18} /> : <Square size={18} />}
        <span>{allSelected ? "Deselect all" : `Select all unpaid (${totalUnpaid})`}</span>
      </button>

      {selectedCount > 0 && (
        <div className="batch-actions">
          <button type="button" className="batch-btn paid" onClick={onBatchPaid}>
            <CreditCard size={16} />
            Mark {selectedCount} paid
          </button>
          <button type="button" className="batch-btn clear" onClick={onClear}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// Job Card Component
function JobCard({
  job,
  isSelected,
  index,
  onToggleSelect,
  onAction,
  onView,
  actionLoading,
  onNotify
}: {
  job: Job;
  isSelected: boolean;
  index: number;
  onToggleSelect: () => void;
  onAction: (action: string) => void;
  onView: () => void;
  actionLoading: boolean;
  onNotify: (kind: "ok" | "err", msg: string) => void;
}) {
  // Print-progress status only — payment is tracked separately via job.paidAt
  // (see the paid pill below) so a job can be released/printed before it's paid.
  const statusMap: Record<string, { label: string; class: string }> = {
    pending_payment: { label: "Queued", class: "warn" },
    paid: { label: "Queued", class: "warn" }, // legacy rows from before payment was decoupled
    approved: { label: "Ready", class: "ready" },
    printing: { label: "Printing", class: "info" },
    printed: { label: "Done", class: "ok" },
    failed: { label: "Failed", class: "danger" },
    cancelled: { label: "Cancelled", class: "danger" },
  };

  const status = statusMap[job.status] || { label: job.status, class: "" };
  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  const handleActionClick = (action: string) => {
    onAction(action);
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
      {!job.paidAt && job.status !== "cancelled" && (
        <button
          className={`job-checkbox ${isSelected ? "selected" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          aria-label={isSelected ? "Deselect job" : "Select job"}
          type="button"
        >
          <span className={`checkbox-circle ${isSelected ? "checked" : ""}`}>
            {isSelected && <Check size={15} strokeWidth={3.5} />}
          </span>
        </button>
      )}

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
              onClick={(e) => { e.stopPropagation(); onAction("resolve_issue"); }}
              disabled={actionLoading}
            >
              Resolve
            </button>
          </div>
        )}
      </div>

      <div className="job-side">
      <div className="job-actions">

        {/* Print status leads the control row — state and its actions read
            together as one line. */}
        <span className={`status-badge ${status.class}`}>{status.label}</span>

        {(job.status === "pending_payment" || job.status === "paid") && (
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
        {(job.status === "printed" || job.status === "failed") && (
          <button type="button" className="job-btn reprint" onClick={() => handleActionClick("reprint")} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            <span>{job.status === "failed" ? "Retry" : "Reprint"}</span>
          </button>
        )}
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
        <button type="button" className="job-btn view" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onView(); }} aria-label="Open job details">
          <Eye size={14} />
        </button>
        {/* Destructive action sits last, visually separated in red. */}
        {job.status !== "printed" && job.status !== "cancelled" && (
          <button type="button" className="job-btn cancel" onClick={() => handleActionClick("cancelled")} disabled={actionLoading} aria-label="Cancel job">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Payment strip: right-aligned under the action row — amount, then
          payment status, then the pay action. One glance, one place. */}
      <div className="job-pay-row">
        <span className="job-price">{formatRupees(job.pricePaise)}</span>
        {job.paidAt ? (
          <span className="status-badge ok"><Check size={12} aria-hidden="true" /> Paid</span>
        ) : job.status !== "cancelled" ? (
          <span className="status-badge warn">Unpaid</span>
        ) : null}
        {!job.paidAt && job.status !== "cancelled" && (
          <button type="button" className="job-btn paid" onClick={() => handleActionClick("paid")} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <CreditCard size={14} />}
            <span>Mark as Paid</span>
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

// Empty State Component
function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Printer size={48} strokeWidth={1} />
      </div>
      <h3>No jobs found</h3>
      <p>{message}</p>
    </div>
  );
}

// Main Dashboard Component
export default function AdminDashboard() {
  const [loggedIn, setLoggedIn] = useState(false);
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: number; kind: "ok" | "err"; msg: string; leaving?: boolean }>>([]);
  const toastIdRef = useRef(0);
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

  const pushToast = useCallback((kind: "ok" | "err", msg: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, kind, msg }]);
    setTimeout(() => setToasts((prev) => prev.map((t) => t.id === id ? { ...t, leaving: true } : t)), 3200);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/jobs", { credentials: "include" });
    if (response.status === 401) { setLoggedIn(false); return; }
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
  }, []);

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
          // Update only the changed job status/paidAt in place
          setJobs((prev) => prev.map((j) => j.id === data.jobId ? { ...j, status: data.status, paidAt: data.paidAt ?? j.paidAt } : j));
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

  async function login(username: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) {
        return { success: false, error: "Invalid username or password" };
      }
      await load();
      return { success: true };
    } catch {
      return { success: false, error: "Connection error. Please try again." };
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    setLoggedIn(false);
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
      const endpoint = action === "convert"
        ? `/api/admin/jobs/${jobId}/convert`
        : action === "reprint"
          ? `/api/admin/jobs/${jobId}/reprint`
          : action === "resolve_issue"
            ? `/api/admin/jobs/${jobId}/resolve-issue`
            : `/api/admin/jobs/${jobId}/status`;
      const noBodyActions = ["reprint", "convert", "resolve_issue"];
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: noBodyActions.includes(action) ? undefined : JSON.stringify({ status: action })
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setLoggedIn(false);
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
  const filteredJobs = filterStatus === "all"
    ? jobs
    : filterStatus === "unpaid"
      ? jobs.filter((j) => !j.paidAt && j.status !== "cancelled")
      : filterStatus === "pending_payment"
        ? jobs.filter((j) => j.status === "pending_payment" || j.status === "paid")
        : jobs.filter((j) => j.status === filterStatus);
  const pending = jobs.filter((j) => !j.paidAt && j.status !== "cancelled");
  const activeJobs = jobs.filter((j) => !["printed", "cancelled", "failed"].includes(j.status));

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
    return (
      <main className="admin-login-shell">
        <AdminLogin onLogin={login} />
      </main>
    );
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

      <StatsBar activeJobs={activeJobs.length} todayRevenue={summary.totalPaise} />

      <FilterTabs
        filters={statusFilters}
        activeFilter={filterStatus}
        counts={counts}
        onFilterChange={setFilterStatus}
      />

      {pending.length > 0 && (
        <BatchBar
          selectedCount={selectedJobs.size}
          totalUnpaid={pending.length}
          onSelectAll={selectAll}
          onBatchPaid={batchAction}
          onClear={() => setSelectedJobs(new Set())}
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
              onAction={(action) => jobAction(job.id, action)}
              onView={() => window.location.href = `/admin/jobs/${job.id}`}
              actionLoading={actionLoading === job.id}
              onNotify={pushToast}
            />
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="jobs-count">
          <span>{filterStatus === "all" ? jobs.length : filteredJobs.length} of {total} jobs</span>
          {hasMore && filterStatus === "all" && (
            <button type="button" className="load-more-btn" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <><Loader2 size={14} className="spin" /> Loading...</> : "Load more"}
            </button>
          )}
        </div>
      )}

      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind} ${t.leaving ? "leaving" : ""}`}>
              {t.kind === "ok" ? <Check size={16} /> : <X size={16} />}
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
      )}
      </main>
    </>
  );
}
