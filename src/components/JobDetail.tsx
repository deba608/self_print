"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import {
  ChevronLeft, CreditCard, Printer, RotateCcw, Save, X,
  FileText, Image, Clock, CheckCircle2, AlertCircle, Loader2
} from "lucide-react";
import { paperSizeLabels } from "@/lib/pricing";

type Detail = {
  job: {
    id: string;
    token: string;
    status: string;
    printType: string;
    copies: number;
    pageRange: string | null;
    paperSize: string;
    layout: string;
    pagesPerSheet: number;
    margins: string;
    scale: string;
    pageCount: number;
    pricePaise: number;
    needsConversion: 0 | 1;
    createdAt: string;
    expiresAt: string;
  };
  file: { id: string; originalName: string; mimeType: string; fileKind: string; sizeBytes: number };
  events: Array<{ id: string; event_type: string; message: string; created_at: string }>;
};

type PrintSettingsForm = {
  printType: string;
  copies: number;
  pageRange: string;
  paperSize: string;
  layout: string;
  pagesPerSheet: number;
  margins: string;
  scale: string;
};

const paperSizeOptions = ["A3", "A4", "A5", "A6", "B5", "Letter", "Legal", "Photo"];

export default function JobDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<PrintSettingsForm | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [activeTab, setActiveTab] = useState<"details" | "preview" | "settings" | "log">("details");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const response = await fetch(`/api/admin/jobs/${id}`);
    if (!response.ok) {
      setError("Unable to load job");
      return;
    }
    const nextDetail = await response.json() as Detail;
    setDetail(nextDetail);
    setSettings(settingsFromJob(nextDetail.job));
  }

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [id]);

  async function setStatus(status: string) {
    setError("");
    const response = await fetch(`/api/admin/jobs/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Action failed");
    await load();
  }

  async function reprint() {
    const response = await fetch(`/api/admin/jobs/${id}/reprint`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? "Reprint failed");
    await load();
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setError("");
    setSavingSettings(true);
    setSettingsSaved(false);
    const response = await fetch(`/api/admin/jobs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
    const body = await response.json();
    setSavingSettings(false);
    if (!response.ok) {
      setError(body.error ?? "Unable to save print settings");
      return;
    }
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
    await load();
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

  if (!detail) {
    return (
      <main className="shell">
        <div className="job-detail-loading">
          <Loader2 size={32} className="spin" />
          <p>Loading job details...</p>
        </div>
      </main>
    );
  }

  const { job, file } = detail;
  const previewUrl = `/api/uploads/${file.id}`;
  const settingsLocked = job.status === "approved" || job.status === "printing";
  const badge = statusBadge(job.status);
  const expiry = expiryLabel(job.expiresAt);
  const showMobileTabs = typeof window !== "undefined" && window.innerWidth < 760;

  return (
    <main className="shell">
      {/* Back navigation */}
      <Link href="/admin" className="back-link">
        <ChevronLeft size={18} />
        <span>Back to Queue</span>
      </Link>

      {/* Header card */}
      <div className="job-detail-header">
        <div className="job-detail-left">
          <div className="token">{job.token}</div>
          <span className={`status-badge ${badge.cls}`}>{badge.label}</span>
          {job.needsConversion === 1 && (
            <span className="conversion-note">⚠ Needs conversion</span>
          )}
        </div>
        <div className="job-detail-right">
          <strong className="job-detail-price">{formatRupees(job.pricePaise)}</strong>
          <span className={`expiry-chip ${expiry.expired ? "expired" : expiry.urgent ? "urgent" : ""}`}>
            <Clock size={12} />
            {expiry.text}
          </span>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => setError("")}><X size={14} /></button>
        </div>
      )}

      {/* Mobile tabs */}
      <div className="mobile-tabs">
        {(["details", "preview", "settings", "log"] as const).map((tab) => (
          <button
            key={tab}
            className={`mobile-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Details tab */}
      {(activeTab === "details" || typeof window !== "undefined" && window.innerWidth >= 760) && (
        <div className="detail-section" data-show-desktop>
          <div className="job-detail-grid">
            <div className="job-detail-col">
              {/* File card */}
              <div className="detail-card">
                <h3 className="card-title">
                  {file.fileKind === "pdf" ? <FileText size={16} /> :
                   file.fileKind === "image" ? <Image size={16} /> :
                   <FileText size={16} />}
                  File
                </h3>
                <div className="file-info-row">
                  <span className="file-name-display">{file.originalName}</span>
                </div>
                <div className="file-meta">
                  <span>{(file.sizeBytes / 1024).toFixed(1)} KB</span>
                  <span>·</span>
                  <span>{file.fileKind.toUpperCase()}</span>
                </div>
              </div>

              {/* Summary card */}
              <div className="detail-card">
                <h3 className="card-title"><Printer size={16} /> Print Summary</h3>
                <div className="summary-list">
                  <div className="summary-row">
                    <span>Type</span>
                    <strong>{job.printType === "bw" ? "Black & White" : "Color"}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Copies</span>
                    <strong>{job.copies}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Pages</span>
                    <strong>{job.pageRange || "All"}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Paper</span>
                    <strong>{paperSizeLabels[job.paperSize as keyof typeof paperSizeLabels] || job.paperSize}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Layout</span>
                    <strong>{job.layout.charAt(0).toUpperCase() + job.layout.slice(1)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Pages/Sheet</span>
                    <strong>{job.pagesPerSheet}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Margins</span>
                    <strong>{job.margins.charAt(0).toUpperCase() + job.margins.slice(1)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Scale</span>
                    <strong>{scaleLabel(job.scale)}</strong>
                  </div>
                  <div className="summary-row">
                    <span>Uploaded</span>
                    <strong>{new Date(job.createdAt).toLocaleString()}</strong>
                  </div>
                </div>
              </div>

              {/* Actions card */}
              <div className="detail-card">
                <h3 className="card-title">Actions</h3>
                <div className="action-grid">
                  {job.status === "pending_payment" && (
                    <button className="action-btn action-paid" onClick={() => setStatus("paid")}>
                      <CreditCard size={16} /> Mark Paid
                    </button>
                  )}
                  {(job.status === "paid") && (
                    <button className="action-btn action-release" onClick={() => setStatus("approved")}>
                      <Printer size={16} /> Release Print
                    </button>
                  )}
                  {job.status === "printing" && (
                    <>
                      <button className="action-btn action-secondary" onClick={() => setStatus("printed")}>
                        <CheckCircle2 size={16} /> Mark Done
                      </button>
                      <button className="action-btn action-secondary" onClick={reprint}>
                        <RotateCcw size={16} /> Reprint
                      </button>
                    </>
                  )}
                  {job.status === "approved" && (
                    <>
                      <button className="action-btn action-secondary" onClick={() => setStatus("printed")}>
                        <CheckCircle2 size={16} /> Mark Done
                      </button>
                      <button className="action-btn action-secondary" onClick={reprint}>
                        <RotateCcw size={16} /> Reprint
                      </button>
                    </>
                  )}
                  {job.status === "printed" && (
                    <button className="action-btn action-secondary" onClick={reprint}>
                      <RotateCcw size={16} /> Reprint
                    </button>
                  )}
                  {!["printed", "cancelled", "failed"].includes(job.status) && (
                    <button className="action-btn action-danger" onClick={() => setStatus("cancelled")}>
                      <X size={16} /> Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="job-detail-col">
              {/* Preview card */}
              <div className="detail-card">
                <h3 className="card-title">
                  {file.fileKind === "pdf" ? <FileText size={16} /> : <Image size={16} />}
                  Preview
                </h3>
                <div className="preview-area">
                  {file.fileKind === "pdf" ? (
                    <iframe src={previewUrl} className="preview-iframe" title="File Preview" />
                  ) : file.fileKind === "image" ? (
                    <img src={previewUrl} alt={file.originalName} className="preview-image" />
                  ) : (
                    <div className="doc-preview-note">
                      <FileText size={40} />
                      <p>DOC/DOCX preview not available</p>
                      <span>File will be reviewed at the shop</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Edit settings card */}
              <div className="detail-card settings-card">
                <h3 className="card-title"><Save size={16} /> Edit Settings</h3>
                {settingsLocked && (
                  <div className="settings-locked-note">
                    <AlertCircle size={14} />
                    Settings are locked while job is being processed
                  </div>
                )}
                <form className="settings-form" onSubmit={saveSettings}>
                  <div className="settings-grid">
                    <div className="settings-field">
                      <label>Print Type</label>
                      <select
                        value={settings!.printType}
                        disabled={settingsLocked}
                        onChange={(e) => setSettings!({ ...settings!, printType: e.target.value })}
                      >
                        <option value="bw">Black & White</option>
                        <option value="color">Color</option>
                      </select>
                    </div>
                    <div className="settings-field">
                      <label>Copies</label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={settings!.copies}
                        disabled={settingsLocked}
                        onChange={(e) => setSettings!({ ...settings!, copies: Number(e.target.value) })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>Page Range</label>
                      <input
                        placeholder="All or 1-5"
                        value={settings!.pageRange}
                        disabled={settingsLocked}
                        onChange={(e) => setSettings!({ ...settings!, pageRange: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>Paper Size</label>
                      <select
                        value={settings!.paperSize}
                        disabled={settingsLocked}
                        onChange={(e) => setSettings!({ ...settings!, paperSize: e.target.value })}
                      >
                        {paperSizeOptions.map((size) => (
                          <option key={size} value={size}>
                            {paperSizeLabels[size as keyof typeof paperSizeLabels] || size}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-field">
                      <label>Layout</label>
                      <select
                        value={settings!.layout}
                        disabled={settingsLocked}
                        onChange={(e) => setSettings!({ ...settings!, layout: e.target.value })}
                      >
                        <option value="portrait">Portrait</option>
                        <option value="landscape">Landscape</option>
                      </select>
                    </div>
                    <div className="settings-field">
                      <label>Pages/Sheet</label>
                      <select
                        value={settings!.pagesPerSheet}
                        disabled={settingsLocked}
                        onChange={(e) => setSettings!({ ...settings!, pagesPerSheet: Number(e.target.value) })}
                      >
                        {[1, 2, 4, 6, 9, 16].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="settings-field">
                      <label>Margins</label>
                      <select
                        value={settings!.margins}
                        disabled={settingsLocked}
                        onChange={(e) => setSettings!({ ...settings!, margins: e.target.value })}
                      >
                        <option value="default">Default</option>
                        <option value="minimum">Minimum</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                    <div className="settings-field">
                      <label>Scale</label>
                      <select
                        value={settings!.scale}
                        disabled={settingsLocked}
                        onChange={(e) => setSettings!({ ...settings!, scale: e.target.value })}
                      >
                        <option value="default">Auto</option>
                        <option value="fit">Fit to Page</option>
                        <option value="shrink">Shrink if Oversized</option>
                        <option value="noscale">Actual Size</option>
                      </select>
                    </div>
                  </div>
                  <div className="settings-actions">
                    <button type="submit" className="action-btn action-save" disabled={savingSettings || settingsLocked}>
                      {savingSettings ? <><Loader2 size={15} className="spin" /> Saving...</> : <><Save size={15} /> Save Settings</>}
                    </button>
                    {settingsSaved && (
                      <span className="saved-msg"><CheckCircle2 size={14} /> Saved</span>
                    )}
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Log tab (mobile only) */}
      {activeTab === "log" && (
        <div className="detail-section">
          <div className="detail-card">
            <h3 className="card-title">Event Log</h3>
            <div className="event-log">
              {detail.events.length === 0 ? (
                <p className="muted" style={{ fontSize: 13, padding: "8px 0" }}>No events yet.</p>
              ) : (
                detail.events.map((event) => (
                  <div key={event.id} className="event-item">
                    <span className="event-time">{new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className="event-type">{event.event_type}</span>
                    <span className="event-msg">{event.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function settingsFromJob(job: Detail["job"]): PrintSettingsForm {
  return {
    printType: job.printType,
    copies: job.copies,
    pageRange: job.pageRange ?? "",
    paperSize: job.paperSize,
    layout: job.layout ?? "portrait",
    pagesPerSheet: job.pagesPerSheet ?? 1,
    margins: job.margins ?? "default",
    scale: job.scale ?? "default"
  };
}

function scaleLabel(value: string) {
  const map: Record<string, string> = {
    default: "Auto", fit: "Fit to Page", shrink: "Shrink if Oversized", noscale: "Actual Size"
  };
  return map[value] ?? value;
}
