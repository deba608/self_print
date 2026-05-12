"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, CreditCard, Printer, RotateCcw, Save, X } from "lucide-react";

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

export default function JobDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<PrintSettingsForm | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

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

  if (!detail) {
    return <main className="shell"><p>{error || "Loading..."}</p></main>;
  }

  const { job, file } = detail;
  const previewUrl = `/api/uploads/${file.id}`;
  const settingsLocked = job.status === "approved" || job.status === "printing";

  return (
    <main className="shell stack">
      <div className="row between">
        <div>
          <Link className="muted" href="/admin">Back to queue</Link>
          <h1>Token {job.token}</h1>
          <span className="badge">{job.needsConversion ? "needs conversion" : job.status}</span>
        </div>
        <strong className="price">₹{(job.pricePaise / 100).toFixed(2)}</strong>
      </div>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      <section className="grid admin-grid">
        <div className="panel stack">
          <h2>Job Details</h2>
          <table>
            <tbody>
              <tr><th>File</th><td>{file.originalName}</td></tr>
              <tr><th>Pages</th><td>{job.pageCount || "Needs conversion"}</td></tr>
              <tr><th>Type</th><td>{job.printType === "bw" ? "Black & white" : "Color"}</td></tr>
              <tr><th>Copies</th><td>{job.copies}</td></tr>
              <tr><th>Range</th><td>{job.pageRange || "All"}</td></tr>
              <tr><th>Paper</th><td>{job.paperSize}</td></tr>
              <tr><th>Layout</th><td>{labelFor(job.layout)}</td></tr>
              <tr><th>Pages/sheet</th><td>{job.pagesPerSheet}</td></tr>
              <tr><th>Margins</th><td>{labelFor(job.margins)}</td></tr>
              <tr><th>Scale</th><td>{labelFor(job.scale)}</td></tr>
              <tr><th>Uploaded</th><td>{new Date(job.createdAt).toLocaleString()}</td></tr>
            </tbody>
          </table>
          {settings ? (
            <form className="stack" onSubmit={saveSettings}>
              <h2>Print Settings</h2>
              {settingsLocked ? <p className="muted">Settings are locked while this job is released or printing.</p> : null}
              <label>
                Pages
                <input
                  placeholder="All or 1-3,5"
                  value={settings.pageRange}
                  disabled={settingsLocked}
                  onChange={(event) => setSettings({ ...settings, pageRange: event.target.value })}
                />
              </label>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <label>
                  Layout
                  <select
                    value={settings.layout}
                    disabled={settingsLocked}
                    onChange={(event) => setSettings({ ...settings, layout: event.target.value })}
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
                <label>
                  Color
                  <select
                    value={settings.printType}
                    disabled={settingsLocked}
                    onChange={(event) => setSettings({ ...settings, printType: event.target.value })}
                  >
                    <option value="bw">Black & white</option>
                    <option value="color">Color</option>
                  </select>
                </label>
                <label>
                  Paper size
                  <select
                    value={settings.paperSize}
                    disabled={settingsLocked}
                    onChange={(event) => setSettings({ ...settings, paperSize: event.target.value })}
                  >
                    <option value="A4">A4</option>
                    <option value="Letter">Letter</option>
                    <option value="Legal">Legal</option>
                    <option value="Photo">Photo</option>
                  </select>
                </label>
                <label>
                  Pages per sheet
                  <select
                    value={settings.pagesPerSheet}
                    disabled={settingsLocked}
                    onChange={(event) => setSettings({ ...settings, pagesPerSheet: Number(event.target.value) })}
                  >
                    {[1, 2, 4, 6, 9, 16].map((value) => <option value={value} key={value}>{value}</option>)}
                  </select>
                </label>
                <label>
                  Margins
                  <select
                    value={settings.margins}
                    disabled={settingsLocked}
                    onChange={(event) => setSettings({ ...settings, margins: event.target.value })}
                  >
                    <option value="default">Default</option>
                    <option value="none">None</option>
                    <option value="minimum">Minimum</option>
                  </select>
                </label>
                <label>
                  Scale
                  <select
                    value={settings.scale}
                    disabled={settingsLocked}
                    onChange={(event) => setSettings({ ...settings, scale: event.target.value })}
                  >
                    <option value="default">Default</option>
                    <option value="fit">Fit</option>
                    <option value="shrink">Shrink</option>
                    <option value="noscale">Actual size</option>
                  </select>
                </label>
                <label>
                  Copies
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={settings.copies}
                    disabled={settingsLocked}
                    onChange={(event) => setSettings({ ...settings, copies: Number(event.target.value) })}
                  />
                </label>
              </div>
              <div className="row">
                <button disabled={savingSettings || settingsLocked}><Save size={16} /> {savingSettings ? "Saving..." : "Save settings"}</button>
                {settingsSaved ? <span className="muted" style={{ color: "var(--ok)" }}>Saved!</span> : null}
              </div>
            </form>
          ) : null}
          <div className="stack">
            <button onClick={() => setStatus("paid")}><CreditCard size={16} /> Mark paid</button>
            <button onClick={() => setStatus("approved")}><Printer size={16} /> Approve / release</button>
            <button className="secondary" onClick={() => setStatus("printed")}><Check size={16} /> Mark printed</button>
            <button className="secondary" onClick={reprint}><RotateCcw size={16} /> Reprint</button>
            <button className="danger" onClick={() => setStatus("cancelled")}><X size={16} /> Cancel</button>
          </div>
        </div>
        <div className="panel stack">
          <h2>Preview</h2>
          {file.fileKind === "pdf" ? <iframe className="preview" src={previewUrl} /> : null}
          {file.fileKind === "image" ? <img className="preview" src={previewUrl} alt={file.originalName} /> : null}
          {file.fileKind === "document" ? <p className="muted">DOC/DOCX files are stored only in this MVP. Convert to PDF before release.</p> : null}
          <h3>Events</h3>
          <div className="stack">
            {detail.events.map((event) => (
              <div className="card" style={{ padding: 10 }} key={event.id}>
                <strong>{event.event_type}</strong>
                <p className="muted" style={{ marginBottom: 0 }}>{event.message} · {new Date(event.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
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

function labelFor(value: string) {
  if (value === "bw") return "Black & white";
  if (value === "noscale") return "Actual size";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
