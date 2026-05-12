"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { RefreshCw, Settings, DollarSign, LogOut, Printer, Bell, BellOff, CheckSquare, Square } from "lucide-react";

type Job = {
  id: string;
  token: string;
  status: string;
  pricePaise: number;
  createdAt: string;
  needsConversion: 0 | 1;
  queuePosition: number;
  expiresAt: string;
  file: { originalName: string };
};

type Pricing = {
  bwPerPagePaise: number;
  colorPerPagePaise: number;
  photoPrintPaise: number;
  copyMultiplier: number;
  a4Multiplier: number;
  legalMultiplier: number;
  photoMultiplier: number;
  expiryMinutes: number;
};

type PrinterOption = {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
  seenAt: string;
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
  const [showBatch, setShowBatch] = useState(false);
  const [printerName, setPrinterName] = useState("");
  const [printers, setPrinters] = useState<PrinterOption[]>([]);
  const [printerSaved, setPrinterSaved] = useState(false);
  const [showPrinter, setShowPrinter] = useState(false);
  const [now, setNow] = useState(Date.now());
  const esRef = useRef<EventSource | null>(null);
  const lastSeenIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/jobs");
    if (response.status === 401) {
      setLoggedIn(false);
      return;
    }
    const body = await response.json();
    const jobsWithExpiry = (body.jobs ?? []).map((j: Job) => ({
      ...j,
      expiresAt: j.expiresAt || new Date(new Date(j.createdAt).getTime() + (body.expiryMinutes || 1440) * 60000).toISOString()
    }));
    lastSeenIds.current = new Set(jobsWithExpiry.map((j: Job) => j.id));
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
      setPrinterName((current) => current || printersData.selectedPrinterName || "");
    }
  }

  async function connectSSE() {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("/api/admin/notifications");
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "new_job") {
        setNewJobCount((n) => n + 1);
      }
      load();
    };
    es.onopen = () => setSseConnected(true);
    es.onerror = () => {
      setSseConnected(false);
      setTimeout(connectSSE, 5000);
    };
    esRef.current = es;
  }

  useEffect(() => {
    if (loggedIn) {
      connectSSE();
      const interval = setInterval(() => setNow(Date.now()), 30000);
      return () => {
        clearInterval(interval);
        if (esRef.current) esRef.current.close();
      };
    }
  }, [loggedIn]);

  useEffect(() => {
    load();
  }, [load]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) {
      setError("Invalid login");
      return;
    }
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
    if (response.ok) {
      setPricing(pricingForm);
      setPricingSaved(true);
      setTimeout(() => setPricingSaved(false), 2000);
    }
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
    }
  }

  async function batchAction(action: "paid" | "approved") {
    const ids = Array.from(selectedJobs);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/admin/jobs/${id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: action })
        })
      )
    );
    setSelectedJobs(new Set());
    setShowBatch(false);
    await load();
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedJobs);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedJobs(next);
  }

  function selectAll() {
    if (selectedJobs.size === jobs.filter((j) => j.status === "pending_payment").length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(jobs.filter((j) => j.status === "pending_payment").map((j) => j.id)));
    }
  }

  function expiryLabel(expiresAt: string) {
    const ms = new Date(expiresAt).getTime() - now;
    if (ms <= 0) return "Expired";
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins}m left`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m left`;
    return `${Math.floor(hrs / 24)}d left`;
  }

  function statusColor(status: string) {
    if (status === "printed") return "ok";
    if (status === "pending_payment") return "warn";
    if (status === "failed" || status === "cancelled") return "danger";
    return "";
  }

  if (!loggedIn) {
    return (
      <main className="customer-shell">
        <section className="panel stack">
          <h1>Admin Login</h1>
          <form className="stack" onSubmit={login}>
            <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label>Password/PIN<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
            <button>Login</button>
          </form>
        </section>
      </main>
    );
  }

  const pendingJobs = jobs.filter((j) => j.status === "pending_payment");
  const paidJobs = jobs.filter((j) => j.status === "paid");
  const activeJobs = jobs.filter((j) => !["printed", "cancelled", "failed"].includes(j.status));

  return (
    <main className="shell stack">
      <div className="row between">
        <div>
          <h1>Print Queue</h1>
          <p className="muted">
            {activeJobs.length} active · {summary.jobs} paid today · ₹{(summary.totalPaise / 100).toFixed(2)}
            {sseConnected && <span className="sse-dot" title="Live updates connected" />}
          </p>
        </div>
        <div className="row">
          {newJobCount > 0 && (
            <button className="notification-btn" onClick={load}>
              <Bell size={16} /> {newJobCount} new
            </button>
          )}
          <button className="secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
          <button className="secondary" onClick={() => { setShowPrinter(!showPrinter); setShowSettings(false); }}>
            <Printer size={16} /> Printer
          </button>
          <button className="secondary" onClick={() => { setShowSettings(!showSettings); setShowPrinter(false); }}>
            <Settings size={16} /> Settings
          </button>
          <button className="secondary" onClick={logout}><LogOut size={16} /> Logout</button>
        </div>
      </div>

      {showPrinter && (
        <section className="panel stack">
          <h2><Printer size={18} /> Printer Settings</h2>
          {printers.length ? (
            <label>
              Active printer
              <select value={printerName} onChange={(e) => setPrinterName(e.target.value)}>
                {printers.map((printer) => (
                  <option value={printer.name} key={printer.name}>
                    {printer.name}{printer.isDefault ? " (Windows default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Active printer
              <input
                value={printerName}
                onChange={(e) => setPrinterName(e.target.value)}
                placeholder="e.g. HP LaserJet 4050"
              />
            </label>
          )}
          {printers.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {printers.map((printer) => (
                <div className="card" style={{ padding: 10 }} key={printer.name}>
                  <strong>{printer.name}</strong>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {printer.driverName || "Unknown driver"} · {printer.portName || "Unknown port"}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          <p className="muted" style={{ fontSize: 13, marginTop: -8 }}>
            Start the Windows print agent to auto-detect connected printers. Manual entry is available when no printer list has been reported yet.
          </p>
          <div className="row">
            <button onClick={savePrinter}>Save Printer</button>
            {printerSaved && <span className="muted" style={{ color: "var(--ok)" }}>Saved!</span>}
          </div>
        </section>
      )}

      {showSettings && pricingForm && (
        <section className="panel stack">
          <h2><DollarSign size={18} /> Pricing & Settings</h2>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <label>
              B/W per page (₹)
              <input type="number" min="0" step="0.01"
                value={pricingForm.bwPerPagePaise / 100}
                onChange={(e) => setPricingForm({ ...pricingForm, bwPerPagePaise: Math.round(Number(e.target.value) * 100) })} />
            </label>
            <label>
              Color per page (₹)
              <input type="number" min="0" step="0.01"
                value={pricingForm.colorPerPagePaise / 100}
                onChange={(e) => setPricingForm({ ...pricingForm, colorPerPagePaise: Math.round(Number(e.target.value) * 100) })} />
            </label>
            <label>
              Photo print (₹)
              <input type="number" min="0" step="0.01"
                value={pricingForm.photoPrintPaise / 100}
                onChange={(e) => setPricingForm({ ...pricingForm, photoPrintPaise: Math.round(Number(e.target.value) * 100) })} />
            </label>
            <label>
              Copy multiplier
              <input type="number" min="0" step="0.1"
                value={pricingForm.copyMultiplier}
                onChange={(e) => setPricingForm({ ...pricingForm, copyMultiplier: Number(e.target.value) })} />
            </label>
            <label>
              Legal multiplier
              <input type="number" min="0" step="0.1"
                value={pricingForm.legalMultiplier}
                onChange={(e) => setPricingForm({ ...pricingForm, legalMultiplier: Number(e.target.value) })} />
            </label>
            <label>
              Photo multiplier
              <input type="number" min="0" step="0.1"
                value={pricingForm.photoMultiplier}
                onChange={(e) => setPricingForm({ ...pricingForm, photoMultiplier: Number(e.target.value) })} />
            </label>
            <label>
              Job expiry (minutes)
              <input type="number" min="30" step="10"
                value={pricingForm.expiryMinutes}
                onChange={(e) => setPricingForm({ ...pricingForm, expiryMinutes: Number(e.target.value) })} />
            </label>
          </div>
          <div className="row">
            <button onClick={savePricing}>Save Settings</button>
            {pricingSaved && <span className="muted" style={{ color: "var(--ok)" }}>Saved!</span>}
          </div>
        </section>
      )}

      {pendingJobs.length > 0 && (
        <section className="panel batch-panel">
          <div className="row between">
            <span className="batch-label">
              {selectedJobs.size > 0 ? `${selectedJobs.size} selected` : `Pending (${pendingJobs.length})`}
            </span>
            <div className="row">
              <button className="text-btn" onClick={selectAll}>
                {selectedJobs.size === pendingJobs.length ? <CheckSquare size={14} /> : <Square size={14} />}
                {selectedJobs.size === pendingJobs.length ? "Deselect all" : "Select all"}
              </button>
              {selectedJobs.size > 0 && (
                <>
                  <button className="batch-btn" onClick={() => batchAction("paid")}>Mark paid</button>
                  <button className="batch-btn" onClick={() => setShowBatch(false)}>Cancel</button>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="job-list">
        {jobs.map((job) => (
          <div className={`job-item ${job.status === "pending_payment" ? "selectable" : ""}`} key={job.id}>
            {job.status === "pending_payment" && (
              <input
                type="checkbox"
                className="job-checkbox"
                checked={selectedJobs.has(job.id)}
                onChange={() => toggleSelect(job.id)}
              />
            )}
            <Link className="job-link" href={`/admin/jobs/${job.id}`}>
              <div className="row between">
                <div className="row gap-sm">
                  <span className="queue-pos">#{job.queuePosition}</span>
                  <strong>Token {job.token}</strong>
                </div>
                <div className="row gap-sm">
                  <span className={`expiry-badge ${expiryLabel(job.expiresAt) === "Expired" ? "expired" : ""}`}>
                    {expiryLabel(job.expiresAt)}
                  </span>
                  <span className={`badge ${statusColor(job.status)}`}>
                    {job.needsConversion ? "needs conversion" : job.status}
                  </span>
                </div>
              </div>
              <span>{job.file.originalName}</span>
              <span className="muted">₹{(job.pricePaise / 100).toFixed(2)} · {new Date(job.createdAt).toLocaleString()}</span>
            </Link>
          </div>
        ))}
        {!jobs.length ? <p className="muted">No jobs yet.</p> : null}
      </section>
    </main>
  );
}
