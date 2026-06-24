"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import {
  ChevronLeft, CreditCard, Printer, RotateCcw, Save, X,
  FileText, Image, CheckCircle2, AlertCircle, Loader2, Circle,
  Upload, Send, FileCheck, IndianRupee
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
    scale: string;
    pageCount: number;
    pricePaise: number;
    needsConversion: 0 | 1;
    createdAt: string;
  };
  file: { id: string; originalName: string; mimeType: string; fileKind: string; sizeBytes: number } | null;
  events: Array<{ id: string; event_type: string; message: string; created_at: string }>;
};

type PrintSettingsForm = {
  printType: string;
  copies: number;
  pageRange: string;
  paperSize: string;
  layout: string;
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

  async function load(syncSettings = true) {
    const response = await fetch(`/api/admin/jobs/${id}`, { credentials: "include" });
    if (!response.ok) {
      setError("Unable to load job");
      return;
    }
    const nextDetail = await response.json() as Detail;
    setDetail(nextDetail);
    // Only refresh the settings form on explicit loads, never on background
    // polls — otherwise a poll would wipe an admin's unsaved edits.
    if (syncSettings) setSettings(settingsFromJob(nextDetail.job));
  }

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    // Live-refresh job + events so the progress tracker updates on its own while
    // the agent works. Stop polling once the job reaches a terminal state.
    const poll = setInterval(() => {
      setDetail((current) => {
        if (current && ["printed", "cancelled"].includes(current.job.status)) return current;
        load(false);
        return current;
      });
    }, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(poll);
    };
  }, [id]);

  async function setStatus(status: string) {
    setError("");
    const response = await fetch(`/api/admin/jobs/${id}/status`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Action failed");
      return;
    }
    await load();
  }

  async function reprint() {
    const response = await fetch(`/api/admin/jobs/${id}/reprint`, { method: "POST", credentials: "include" });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error ?? "Reprint failed");
      return;
    }
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
      credentials: "include",
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
    return `₹ ${(paise / 100).toFixed(2)}`;
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
  const previewUrl = file ? `/api/uploads/${file.id}` : "";
  const settingsLocked = job.status === "approved" || job.status === "printing";
  const badge = statusBadge(job.status);

  return (
    <main className="admin-shell job-detail-shell">
      {/* Back navigation */}
      <Link href="/admin" className="back-link">
        <ChevronLeft size={18} />
        <span>Back to Queue</span>
      </Link>

      <div className="job-detail-header">
        <div className="job-detail-left">
          <div className="job-detail-token">
            <span>Token</span>
            <strong>{job.token}</strong>
          </div>
          <span className={`status-badge ${badge.cls}`}>{badge.label}</span>
          {job.needsConversion === 1 && (
            <span className="conversion-note">Needs conversion</span>
          )}
        </div>
        <div className="job-detail-right">
          <strong className="job-detail-price">{formatRupees(job.pricePaise)}</strong>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}><X size={14} /></button>
        </div>
      )}

      <ProgressTracker job={job} events={detail.events} />

      <div className="mobile-tabs">
        {(["details", "preview", "settings", "log"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            className={`mobile-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="job-detail-grid">
        <section className={`detail-pane detail-pane-details ${activeTab === "details" ? "active" : ""}`}>
          <FileCard file={file} />
          <SummaryCard job={job} />
          <ActionsCard job={job} setStatus={setStatus} reprint={reprint} />
        </section>

        <section className={`detail-pane detail-pane-preview ${activeTab === "preview" ? "active" : ""}`}>
          <PreviewCard file={file} previewUrl={previewUrl} />
        </section>

        <section className={`detail-pane detail-pane-settings ${activeTab === "settings" ? "active" : ""}`}>
          <SettingsCard
            settings={settings}
            settingsLocked={settingsLocked}
            savingSettings={savingSettings}
            settingsSaved={settingsSaved}
            setSettings={setSettings}
            saveSettings={saveSettings}
          />
        </section>

        <section className={`detail-pane detail-pane-log ${activeTab === "log" ? "active" : ""}`}>
          <EventLogCard events={detail.events} />
        </section>
      </div>
    </main>
  );
}

function FileCard({ file }: { file: Detail["file"] }) {
  if (!file) return null;
  return (
    <div className="detail-card">
      <h3 className="card-title">
        {file.fileKind === "image" ? <Image size={16} /> : <FileText size={16} />}
        File
      </h3>
      <div className="file-info-row">
        <span className="file-name-display">{file.originalName}</span>
      </div>
      <div className="file-meta">
        <span>{(file.sizeBytes / 1024).toFixed(1)} KB</span>
        <span className="dot">·</span>
        <span>{file.fileKind.toUpperCase()}</span>
      </div>
    </div>
  );
}

function SummaryCard({ job }: { job: Detail["job"] }) {
  const rows = [
    ["Type", job.printType === "bw" ? "Black & White" : "Color"],
    ["Copies", String(job.copies)],
    ["Pages", job.pageRange || "All"],
    ["Paper", paperSizeLabels[job.paperSize as keyof typeof paperSizeLabels] || job.paperSize],
    ["Layout", titleCase(job.layout)],
    ["Scale", scaleLabel(job.scale)],
    ["Uploaded", new Date(job.createdAt).toLocaleString()]
  ];

  return (
    <div className="detail-card">
      <h3 className="card-title"><Printer size={16} /> Print Summary</h3>
      <div className="summary-list">
        {rows.map(([label, value]) => (
          <div className="summary-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionsCard({
  job,
  setStatus,
  reprint
}: {
  job: Detail["job"];
  setStatus: (status: string) => void;
  reprint: () => void;
}) {
  return (
    <div className="detail-card">
      <h3 className="card-title">Actions</h3>
      <div className="detail-action-grid">
        {job.status === "pending_payment" && (
          <button type="button" className="job-btn paid" onClick={() => setStatus("paid")}>
            <CreditCard size={16} /> Mark Paid
          </button>
        )}
        {job.status === "paid" && (
          <button type="button" className="job-btn release" onClick={() => setStatus("approved")}>
            <Printer size={16} /> Release Print
          </button>
        )}
        {(job.status === "approved" || job.status === "printing" || job.status === "failed") && (
          <button type="button" className="job-btn done" onClick={() => setStatus("printed")}>
            <CheckCircle2 size={16} /> Mark Done
          </button>
        )}
        {(job.status === "printed" || job.status === "failed") && (
          <button type="button" className="job-btn reprint" onClick={reprint}>
            <RotateCcw size={16} /> {job.status === "failed" ? "Retry Print" : "Reprint"}
          </button>
        )}
        {job.status !== "pending_payment" && job.status !== "cancelled" && (
          <button
            type="button"
            className="job-btn manual"
            onClick={() => window.open(`/admin/jobs/${job.id}/print`, "_blank")}
            title="Backup: print via the browser/Windows print dialog"
          >
            <Printer size={16} /> Manual Print
          </button>
        )}
        {!["printed", "cancelled", "failed"].includes(job.status) && (
          <button type="button" className="job-btn cancel-text" onClick={() => setStatus("cancelled")}>
            <X size={16} /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function PreviewCard({ file, previewUrl }: { file: Detail["file"]; previewUrl: string }) {
  if (!file) return null;
  return (
    <div className="detail-card">
      <h3 className="card-title">
        {file.fileKind === "pdf" ? <FileText size={16} /> : <Image size={16} />}
        Preview
      </h3>
      <div className="admin-preview-area">
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
  );
}

function SettingsCard({
  settings,
  settingsLocked,
  savingSettings,
  settingsSaved,
  setSettings,
  saveSettings
}: {
  settings: PrintSettingsForm | null;
  settingsLocked: boolean;
  savingSettings: boolean;
  settingsSaved: boolean;
  setSettings: React.Dispatch<React.SetStateAction<PrintSettingsForm | null>>;
  saveSettings: (event: React.FormEvent) => void;
}) {
  if (!settings) return null;

  return (
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
          <SettingsField label="Print Type">
            <select value={settings.printType} disabled={settingsLocked} onChange={(e) => setSettings({ ...settings, printType: e.target.value })}>
              <option value="bw">Black & White</option>
              <option value="color">Color</option>
            </select>
          </SettingsField>
          <SettingsField label="Copies">
            <input type="number" min="1" max="99" value={settings.copies} disabled={settingsLocked} onChange={(e) => setSettings({ ...settings, copies: Number(e.target.value) })} />
          </SettingsField>
          <SettingsField label="Page Range">
            <input placeholder="All or 1-5" value={settings.pageRange} disabled={settingsLocked} onChange={(e) => setSettings({ ...settings, pageRange: e.target.value })} />
          </SettingsField>
          <SettingsField label="Paper Size">
            <select value={settings.paperSize} disabled={settingsLocked} onChange={(e) => setSettings({ ...settings, paperSize: e.target.value })}>
              {paperSizeOptions.map((size) => (
                <option key={size} value={size}>{paperSizeLabels[size as keyof typeof paperSizeLabels] || size}</option>
              ))}
            </select>
          </SettingsField>
          <SettingsField label="Layout">
            <select value={settings.layout} disabled={settingsLocked} onChange={(e) => setSettings({ ...settings, layout: e.target.value })}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </SettingsField>
          <SettingsField label="Scale">
            <select value={settings.scale} disabled={settingsLocked} onChange={(e) => setSettings({ ...settings, scale: e.target.value })}>
              <option value="default">Auto</option>
              <option value="fit">Fit to Page</option>
              <option value="shrink">Shrink if Oversized</option>
              <option value="noscale">Actual Size</option>
            </select>
          </SettingsField>
        </div>
        <div className="settings-actions">
          <button type="submit" className="job-btn release settings-save-btn" disabled={savingSettings || settingsLocked}>
            {savingSettings ? <><Loader2 size={15} className="spin" /> Saving...</> : <><Save size={15} /> Save Settings</>}
          </button>
          {settingsSaved && <span className="saved-msg"><CheckCircle2 size={14} /> Saved</span>}
        </div>
      </form>
    </div>
  );
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function ProgressTracker({ job, events }: { job: Detail["job"]; events: Detail["events"] }) {
  const types = new Set(events.map((e) => e.event_type));
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const eventTime = (type: string) => {
    const found = events.find((e) => e.event_type === type);
    return found ? fmt(found.created_at) : "";
  };

  const s = job.status;
  const failed = s === "failed";
  const cancelled = s === "cancelled";

  const steps = [
    { key: "created", label: "Submitted", icon: FileText, done: true, time: fmt(job.createdAt) },
    { key: "paid", label: "Payment received", icon: IndianRupee,
      done: ["paid", "approved", "printing", "printed"].includes(s) || types.has("paid"), time: eventTime("paid") },
    { key: "approved", label: "Released to print", icon: Printer,
      done: ["approved", "printing", "printed"].includes(s) || types.has("approved"), time: eventTime("approved") },
    { key: "downloaded", label: "File downloaded", icon: Upload,
      done: types.has("downloaded") || s === "printed", time: eventTime("downloaded") },
    { key: "spooling", label: "Sent to printer", icon: Send,
      done: types.has("spooling") || s === "printed", time: eventTime("spooling") },
    { key: "printed", label: "Printed successfully", icon: FileCheck,
      done: s === "printed" || types.has("printed"), time: eventTime("printed") },
  ];

  // The active step is the first not-yet-done one (unless terminal/failed).
  const activeIdx = failed || cancelled ? -1 : steps.findIndex((st) => !st.done);
  const failIdx = failed ? steps.findIndex((st) => !st.done) : -1;
  const lastFail = failed ? [...events].reverse().find((e) => e.event_type === "failed") : null;

  return (
    <div className="progress-tracker">
      <div className="pt-head">
        <h3 className="card-title">Print Progress</h3>
        {failed && <span className="status-badge danger">Failed</span>}
        {cancelled && <span className="status-badge danger">Cancelled</span>}
        {s === "printed" && <span className="status-badge ok">Completed</span>}
      </div>
      <div className="pt-steps">
        {steps.map((st, i) => {
          const isActive = i === activeIdx;
          const isFail = i === failIdx;
          const cls = st.done ? "done" : isFail ? "failed" : isActive ? "active" : "pending";
          const Icon = st.icon;
          return (
            <div className={`pt-step ${cls}`} key={st.key}>
              <span className="pt-marker">
                {st.done ? <CheckCircle2 size={16} />
                  : isFail ? <AlertCircle size={16} />
                  : isActive ? <Loader2 size={16} className="spin" />
                  : <Icon size={14} />}
              </span>
              <span className="pt-label">{st.label}</span>
              {st.time && <span className="pt-time">{st.time}</span>}
            </div>
          );
        })}
      </div>
      {lastFail && <div className="pt-error">{lastFail.message}</div>}
    </div>
  );
}

function EventLogCard({ events }: { events: Detail["events"] }) {
  return (
    <div className="detail-card">
      <h3 className="card-title">Event Log</h3>
      <div className="event-log">
        {events.length === 0 ? (
          <p className="empty-log">No events yet.</p>
        ) : (
          events.map((event) => (
            <div key={event.id} className="event-item">
              <span className="event-time">{new Date(event.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="event-type">{event.event_type}</span>
              <span className="event-msg">{event.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function settingsFromJob(job: Detail["job"]): PrintSettingsForm {
  return {
    printType: job.printType,
    copies: job.copies,
    pageRange: job.pageRange ?? "",
    paperSize: job.paperSize,
    layout: job.layout ?? "portrait",
    scale: job.scale ?? "default"
  };
}

function scaleLabel(value: string) {
  const map: Record<string, string> = {
    default: "Auto", fit: "Fit to Page", shrink: "Shrink if Oversized", noscale: "Actual Size"
  };
  return map[value] ?? value;
}

function titleCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

