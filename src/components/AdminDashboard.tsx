"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RefreshCw, Settings, DollarSign } from "lucide-react";

type Job = {
  id: string;
  token: string;
  status: string;
  pricePaise: number;
  createdAt: string;
  needsConversion: 0 | 1;
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

  async function load() {
    const response = await fetch("/api/admin/jobs");
    if (response.status === 401) {
      setLoggedIn(false);
      return;
    }
    const body = await response.json();
    setJobs(body.jobs ?? []);
    setLoggedIn(true);
    const summaryResponse = await fetch("/api/admin/summary");
    setSummary(await summaryResponse.json());
    loadPricing();
  }

  async function loadPricing() {
    const res = await fetch("/api/admin/pricing");
    const data = await res.json();
    setPricing(data);
    setPricingForm(data);
  }

  useEffect(() => {
    load();
  }, []);

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

  return (
    <main className="shell stack">
      <div className="row between">
        <div>
          <h1>Print Queue</h1>
          <p className="muted">Today: {summary.jobs} paid jobs · ₹{(summary.totalPaise / 100).toFixed(2)}</p>
        </div>
        <div className="row">
          <button className="secondary" onClick={load}><RefreshCw size={16} /> Refresh</button>
          <button className="secondary" onClick={() => setShowSettings(!showSettings)}><Settings size={16} /> Pricing</button>
        </div>
      </div>

      {showSettings && pricingForm && (
        <section className="panel stack">
          <h2><DollarSign size={18} /> Pricing Settings</h2>
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
          </div>
          <div className="row">
            <button onClick={savePricing}>Save Pricing</button>
            {pricingSaved && <span className="muted" style={{ color: "var(--ok)" }}>Saved!</span>}
          </div>
        </section>
      )}

      <section className="job-list">
        {jobs.map((job) => (
          <Link className="job-item" href={`/admin/jobs/${job.id}`} key={job.id}>
            <div className="row between">
              <strong>Token {job.token}</strong>
              <span className={`badge ${job.status === "printed" ? "ok" : job.needsConversion ? "warn" : ""}`}>{job.needsConversion ? "needs conversion" : job.status}</span>
            </div>
            <span>{job.file.originalName}</span>
            <span className="muted">₹{(job.pricePaise / 100).toFixed(2)} · {new Date(job.createdAt).toLocaleString()}</span>
          </Link>
        ))}
        {!jobs.length ? <p className="muted">No jobs yet.</p> : null}
      </section>
    </main>
  );
}
