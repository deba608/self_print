"use client";

import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp, Clock, Printer, FileText, Download,
  RefreshCw, Loader2, BarChart2, IndianRupee,
  CheckCircle2, AlertCircle
} from "lucide-react";

type DailyJobSummary = {
  date: string;
  totalJobs: number;
  totalRevenuePaise: number;
  confirmedRevenuePaise: number;
  bwJobs: number;
  colorJobs: number;
  photoJobs: number;
  pagesTotal: number;
  printedJobs: number;
  cancelledJobs: number;
  pendingJobs: number;
};

type AccountsSummary = {
  totalRevenuePaise: number;
  confirmedRevenuePaise: number;
  pendingRevenuePaise: number;
  totalJobs: number;
  printedJobs: number;
  totalPages: number;
  bwJobs: number;
  colorJobs: number;
  photoJobs: number;
};

type AnalyticsData = {
  days: DailyJobSummary[];
  summary: {
    totalRevenuePaise: number;
    confirmedRevenuePaise: number;
    totalJobs: number;
    totalPages: number;
    bwJobs: number;
    colorJobs: number;
    photoJobs: number;
  };
  today: AccountsSummary;
};

type Range = "7" | "30";

function formatRupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
  });
}

function BreakdownBar({ bw, color, photo }: { bw: number; color: number; photo: number }) {
  const total = bw + color + photo;
  if (total === 0) return <div className="acct-bar-empty">No data</div>;
  const bwPct    = Math.round((bw / total) * 100);
  const colorPct = Math.round((color / total) * 100);
  const photoPct = 100 - bwPct - colorPct;
  return (
    <div className="acct-breakdown-bar" title={`B&W: ${bwPct}%  Color: ${colorPct}%  Photo: ${photoPct}%`}>
      {bwPct > 0    && <div className="acct-bar-seg bw"    style={{ width: `${bwPct}%`    }}>{bwPct > 8 ? `B&W ${bwPct}%` : ""}</div>}
      {colorPct > 0 && <div className="acct-bar-seg color" style={{ width: `${colorPct}%` }}>{colorPct > 8 ? `Color ${colorPct}%` : ""}</div>}
      {photoPct > 0 && <div className="acct-bar-seg photo" style={{ width: `${photoPct}%` }}>{photoPct > 8 ? `Photo ${photoPct}%` : ""}</div>}
    </div>
  );
}

function exportCSV(days: DailyJobSummary[], range: Range) {
  const header = ["Date", "Total Jobs", "Printed", "Cancelled", "Pending", "Pages", "B&W", "Color", "Photo", "Total Revenue (₹)", "Confirmed Revenue (₹)"];
  const rows = days.map(d => [
    d.date, d.totalJobs, d.printedJobs, d.cancelledJobs, d.pendingJobs,
    d.pagesTotal, d.bwJobs, d.colorJobs, d.photoJobs,
    (d.totalRevenuePaise / 100).toFixed(2),
    (d.confirmedRevenuePaise / 100).toFixed(2),
  ]);
  const csv = [header, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `selfprint-accounts-${range}d.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AccountsTab() {
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [range, setRange]     = useState<Range>("7");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (r: Range = range, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const today = new Date().toISOString().slice(0, 10);
      const from  = (() => {
        const d = new Date();
        d.setDate(d.getDate() - (Number(r) - 1));
        return d.toISOString().slice(0, 10);
      })();
      const res = await fetch(`/api/admin/analytics/daily?from=${from}&to=${today}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load analytics");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => { load(range); }, [range, load]);

  // Auto-refresh every 60 seconds only when tab is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load(range, true);
    }, 60000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(range, true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [range, load]);

  if (loading) {
    return (
      <div className="acct-loading">
        <Loader2 size={32} className="spin" />
        <p>Loading accounts data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="acct-error">
        <AlertCircle size={24} />
        <p>{error}</p>
        <button className="acct-retry-btn" onClick={() => load(range)}>Retry</button>
      </div>
    );
  }

  const { today, days, summary } = data!;
  const totalBwColor = today.bwJobs + today.colorJobs + today.photoJobs;

  return (
    <div className="acct-root">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="acct-header">
        <div className="acct-title-row">
          <div className="acct-title-icon"><BarChart2 size={22} /></div>
          <div>
            <h1>Accounts &amp; Daily Data</h1>
            <p className="acct-title-sub">Revenue, pages, and print mix at a glance</p>
          </div>
        </div>
        <div className="acct-controls">
          <div className="acct-range-toggle">
            {(["7", "30"] as Range[]).map(r => (
              <button
                key={r}
                className={`acct-range-btn ${range === r ? "active" : ""}`}
                onClick={() => setRange(r)}
                type="button"
              >
                {r}d
              </button>
            ))}
          </div>
          <button
            className="acct-refresh-btn"
            onClick={() => load(range, true)}
            disabled={refreshing}
            type="button"
            aria-label="Refresh"
          >
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
          </button>
          <button
            className="acct-export-btn"
            onClick={() => exportCSV(days, range)}
            type="button"
            disabled={days.length === 0}
          >
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Today's Cards ──────────────────────────────────────── */}
      <section className="acct-today-section">
        <p className="acct-section-label">Today — {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
        <div className="acct-cards">
          <div className="acct-card confirmed">
            <div className="acct-card-icon"><IndianRupee size={18} /></div>
            <div className="acct-card-body">
              <span className="acct-card-label">Confirmed Revenue</span>
              <span className="acct-card-value">{formatRupees(today.confirmedRevenuePaise)}</span>
              <span className="acct-card-sub">paid &amp; printed jobs</span>
            </div>
          </div>
          <div className="acct-card pending">
            <div className="acct-card-icon"><Clock size={18} /></div>
            <div className="acct-card-body">
              <span className="acct-card-label">Pending Collection</span>
              <span className="acct-card-value">{formatRupees(today.pendingRevenuePaise)}</span>
              <span className="acct-card-sub">unpaid jobs</span>
            </div>
          </div>
          <div className="acct-card pages">
            <div className="acct-card-icon"><FileText size={18} /></div>
            <div className="acct-card-body">
              <span className="acct-card-label">Pages Printed</span>
              <span className="acct-card-value">{today.totalPages.toLocaleString()}</span>
              <span className="acct-card-sub">today</span>
            </div>
          </div>
          <div className="acct-card done">
            <div className="acct-card-icon"><CheckCircle2 size={18} /></div>
            <div className="acct-card-body">
              <span className="acct-card-label">Jobs Done</span>
              <span className="acct-card-value">{today.printedJobs}</span>
              <span className="acct-card-sub">of {today.totalJobs} total</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Breakdown Bar ──────────────────────────────────────── */}
      {totalBwColor > 0 && (
        <section className="acct-breakdown-section">
          <p className="acct-section-label">Today&apos;s Print Type Mix</p>
          <BreakdownBar bw={today.bwJobs} color={today.colorJobs} photo={today.photoJobs} />
          <div className="acct-bar-legend">
            <span className="leg-bw">B&amp;W ({today.bwJobs})</span>
            <span className="leg-color">Color ({today.colorJobs})</span>
            <span className="leg-photo">Photo ({today.photoJobs})</span>
          </div>
        </section>
      )}

      {/* ── Range Summary ──────────────────────────────────────── */}
      <section className="acct-range-summary">
        <div className="acct-range-card">
          <TrendingUp size={16} />
          <div>
            <span className="acct-rs-label">Revenue ({range}d)</span>
            <span className="acct-rs-value">{formatRupees(summary.confirmedRevenuePaise)}</span>
          </div>
        </div>
        <div className="acct-range-card">
          <Printer size={16} />
          <div>
            <span className="acct-rs-label">Total Jobs ({range}d)</span>
            <span className="acct-rs-value">{summary.totalJobs.toLocaleString()}</span>
          </div>
        </div>
        <div className="acct-range-card">
          <FileText size={16} />
          <div>
            <span className="acct-rs-label">Pages ({range}d)</span>
            <span className="acct-rs-value">{summary.totalPages.toLocaleString()}</span>
          </div>
        </div>
      </section>

      {/* ── Daily Records Table ────────────────────────────────── */}
      <section className="acct-table-section">
        <p className="acct-section-label">Daily Records (last {range} days)</p>
        {days.length === 0 ? (
          <div className="acct-table-empty">No jobs in this period.</div>
        ) : (
          <div className="acct-table-wrapper">
            <table className="acct-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Jobs</th>
                  <th>Pages</th>
                  <th>B&amp;W</th>
                  <th>Color</th>
                  <th>Printed</th>
                  <th>Revenue</th>
                  <th>Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map(d => (
                  <tr key={d.date} className={d.date === new Date().toISOString().slice(0, 10) ? "today-row" : ""}>
                    <td className="date-cell">{formatDate(d.date)}</td>
                    <td>{d.totalJobs}</td>
                    <td>{d.pagesTotal}</td>
                    <td>{d.bwJobs}</td>
                    <td>{d.colorJobs}</td>
                    <td>
                      <span className={`status-pill ${d.printedJobs > 0 ? "done" : "zero"}`}>
                        {d.printedJobs}
                      </span>
                    </td>
                    <td className="rev-cell">{formatRupees(d.totalRevenuePaise)}</td>
                    <td className="rev-cell confirmed-cell">{formatRupees(d.confirmedRevenuePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
