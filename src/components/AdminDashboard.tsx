"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  RefreshCw, Settings, LogOut, Printer, Bell,
  CheckSquare, Square, CreditCard, Eye, X, Check, Monitor, Loader2,
  Lock, Eye as EyeIcon, ChevronDown, Zap, TrendingUp, Clock, Flame
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
          <p>Sign in to manage your print queue</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="username">Username</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
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
                <EyeIcon size={18} />
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
                Sign In
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </>
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>SelfPrint Queue Management System</p>
        </div>
      </div>
    </div>
  );
}

// Stats Cards Component
function StatsBar({ activeJobs, todayRevenue }: { activeJobs: number; todayRevenue: number }) {
  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

  return (
    <div className="stats-bar">
      <div className="stat-card">
        <div className="stat-icon active">
          <Flame size={20} />
        </div>
        <div className="stat-content">
          <span className="stat-label">Active Jobs</span>
          <span className="stat-value">{activeJobs}</span>
        </div>
      </div>
      <div className="stat-card highlight">
        <div className="stat-icon revenue">
          <TrendingUp size={20} />
        </div>
        <div className="stat-content">
          <span className="stat-label">Today&apos;s Revenue</span>
          <span className="stat-value">{formatRupees(todayRevenue)}</span>
        </div>
      </div>
    </div>
  );
}

// Topbar Component
function AdminTopbar({
  printerName,
  newJobCount,
  sseConnected,
  onRefresh,
  onOpenPricing,
  onOpenPrinter,
  onLogout,
  showPricing
}: {
  printerName: string;
  newJobCount: number;
  sseConnected: boolean;
  onRefresh: () => void;
  onOpenPricing: () => void;
  onOpenPrinter: () => void;
  onLogout: () => void;
  showPricing: boolean;
}) {
  return (
    <header className="admin-topbar">
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
        {newJobCount > 0 && (
          <button className="action-btn notification" onClick={onRefresh}>
            <Bell size={18} />
            <span className="notif-badge">{newJobCount}</span>
          </button>
        )}

        <button className="action-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh jobs">
          <RefreshCw size={18} />
        </button>

        <button
          className={`action-btn ${showPricing ? "active" : ""}`}
          onClick={onOpenPricing}
          title="Pricing Settings"
          aria-label="Pricing settings"
        >
          <Settings size={18} />
        </button>

        <div className="sse-indicator" title={sseConnected ? "Live updates active" : "Connecting..."}>
          <span className={`sse-dot ${sseConnected ? "connected" : ""}`}></span>
        </div>

        <button className="action-btn danger" onClick={onLogout} title="Logout" aria-label="Logout">
          <LogOut size={18} />
        </button>
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

  const updatePriceField = (field: "bwPerPagePaise" | "colorPerPagePaise" | "photoPrintPaise", rawValue: string) => {
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
          <button className="panel-close" onClick={onClose} aria-label="Close">
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
            <h3>System Settings</h3>
            <div className="pricing-grid single">
              <div className="pricing-field">
                <label>Job expiry time (minutes)</label>
                <div className="time-input">
                  <Clock size={18} className="time-icon" />
                  <input
                    type="number"
                    min="30"
                    step="10"
                    value={formData.expiryMinutes}
                    onChange={(e) => updateField("expiryMinutes", e.target.value)}
                  />
                  <span className="time-hint">min</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        {error && <p className="panel-error" role="alert">{error}</p>}

        <div className="panel-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saved || saving}>
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
          <button className="panel-close" onClick={onClose} aria-label="Close">
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
      <button className="select-btn" onClick={onSelectAll}>
        {allSelected ? <CheckSquare size={18} /> : <Square size={18} />}
        <span>{allSelected ? "Deselect all" : `Select all unpaid (${totalUnpaid})`}</span>
      </button>

      {selectedCount > 0 && (
        <div className="batch-actions">
          <button className="batch-btn paid" onClick={onBatchPaid}>
            <CreditCard size={16} />
            Mark {selectedCount} paid
          </button>
          <button className="batch-btn clear" onClick={onClear}>
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
  actionLoading
}: {
  job: Job;
  isSelected: boolean;
  index: number;
  onToggleSelect: () => void;
  onAction: (action: string) => void;
  onView: () => void;
  actionLoading: boolean;
}) {
  const statusMap: Record<string, { label: string; class: string }> = {
    pending_payment: { label: "Unpaid", class: "warn" },
    paid: { label: "Paid", class: "info" },
    approved: { label: "Ready", class: "ready" },
    printing: { label: "Printing", class: "info" },
    printed: { label: "Done", class: "ok" },
    failed: { label: "Failed", class: "danger" },
    cancelled: { label: "Cancelled", class: "danger" },
  };

  const status = statusMap[job.status] || { label: job.status, class: "" };
  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

  return (
    <div className={`job-card ${job.status}`} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
      {job.status === "pending_payment" && (
        <button
          className={`job-checkbox ${isSelected ? "selected" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          aria-label={isSelected ? "Deselect job" : "Select job"}
          type="button"
        >
          {isSelected ? <CheckSquare size={22} /> : <Square size={22} />}
        </button>
      )}

      <div className="job-content">
        <div className="job-header">
          <div className="job-title">
            <span className="queue-num">#{job.queuePosition}</span>
            <span className="job-token">Token {job.token}</span>
          </div>
          <div className="job-meta">
            <span className={`status-badge ${status.class}`}>{status.label}</span>
            <span className="job-price">{formatRupees(job.pricePaise)}</span>
          </div>
        </div>

        <div className="job-details">
          <span className="file-name">{job.file.originalName}</span>
          <div className="job-info">
            <span>{job.printType === "bw" ? "B&W" : "Color"}</span>
            <span className="dot">·</span>
            <span>{job.copies} copy</span>
            <span className="dot">·</span>
            <span>{job.paperSize}</span>
            <span className="dot">·</span>
            <span>{new Date(job.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
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
      </div>

      <div className="job-actions">
        {job.status === "pending_payment" && (
          <button className="job-btn paid" onClick={() => onAction("paid")} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <CreditCard size={14} />}
            <span>Paid</span>
          </button>
        )}
        {job.status === "paid" && (
          <button className="job-btn release" onClick={() => onAction("approved")} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <Printer size={14} />}
            <span>Release</span>
          </button>
        )}
        {(job.status === "approved" || job.status === "printing") && (
          <button className="job-btn done" onClick={() => onAction("printed")} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            <span>Done</span>
          </button>
        )}
        {job.status === "printed" && (
          <button className="job-btn reprint" onClick={() => onAction("approved")} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            <span>Reprint</span>
          </button>
        )}
        {!["printed", "cancelled", "failed"].includes(job.status) && (
          <button className="job-btn cancel" onClick={() => onAction("cancelled")} disabled={actionLoading} aria-label="Cancel job">
            <X size={14} />
          </button>
        )}
        <button className="job-btn view" onClick={onView} aria-label="Open job details">
          <Eye size={14} />
        </button>
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
  const [summary, setSummary] = useState({ jobs: 0, totalPaise: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [showPrinter, setShowPrinter] = useState(false);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [printerName, setPrinterName] = useState("");
  const [newJobCount, setNewJobCount] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState("all");
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
      return () => { if (esRef.current) esRef.current.close(); };
    }
  }, [loggedIn]);

  useEffect(() => { load(); }, [load]);

  async function login(username: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
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
    await fetch("/api/admin/logout", { method: "POST" });
    setLoggedIn(false);
  }

  async function savePricing(data: Pricing) {
    const response = await fetch("/api/admin/pricing", {
      method: "PUT",
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

  async function batchAction() {
    const ids = Array.from(selectedJobs);
    await Promise.all(ids.map((id) =>
      fetch(`/api/admin/jobs/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" })
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
    const allSelected = selectedJobs.size === pending.length && pending.length > 0;
    setSelectedJobs(allSelected ? new Set() : new Set(pending));
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

  const counts = statusFilters.reduce((acc, f) => {
    acc[f.value] = f.value === "all" ? jobs.length : jobs.filter((j) => j.status === f.value).length;
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
    <main className="admin-shell">
      <AdminTopbar
        printerName={printerName}
        newJobCount={newJobCount}
        sseConnected={sseConnected}
        onRefresh={load}
        onOpenPricing={() => { setShowSettings(true); setShowPrinter(false); }}
        onOpenPrinter={() => { setShowPrinter(true); setShowSettings(false); }}
        onLogout={logout}
        showPricing={showSettings}
      />

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
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ printerName: name })
            });
            setPrinterName(name);
          }}
          onClose={() => setShowPrinter(false)}
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

      {filteredJobs.length === 0 ? (
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
            />
          ))}
        </div>
      )}
    </main>
  );
}
