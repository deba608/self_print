"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Database,
  FileClock,
  History,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { RetentionConfig } from "@/lib/types";

type LastCleanupRun = {
  ranAt: string;
  deletedJobs: number;
  jobFilesRemoved: number;
  strayFilesRemoved: number;
} | null;

type RetentionDraft = { [Key in keyof RetentionConfig]: RetentionConfig[Key] | "" };

const FIELD_DEFS: Array<{
  key: keyof RetentionConfig;
  label: string;
  hint: string;
  unit: string;
}> = [
  {
    key: "cartAbandonMinutes",
    label: "Abandoned cart timeout",
    hint: "Unpaid, unreleased jobs are removed from the queue after this long.",
    unit: "min",
  },
  {
    key: "fileRetentionDays",
    label: "File retention",
    hint: "Uploaded file bytes are deleted after this many days (job history is kept forever).",
    unit: "days",
  },
  {
    key: "strayFileRetentionHours",
    label: "Stray file retention",
    hint: "Orphaned uploads with no matching job row are purged after this long.",
    unit: "hrs",
  },
  {
    key: "loginEventRetentionDays",
    label: "Login event retention",
    hint: "Staff login history older than this is deleted.",
    unit: "days",
  },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DataRetentionManagement() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<RetentionDraft | null>(null);
  const [lastRun, setLastRun] = useState<LastCleanupRun>(null);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/retention", { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Unable to load retention settings.");
      setDraft(body.config);
      setLastRun(body.lastRun ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load retention settings.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateField(key: keyof RetentionConfig, value: string) {
    setSaveOk(false);
    setSaveError("");
    setDraft((prev) => {
      if (!prev) return prev;
      if (value === "") return { ...prev, [key]: "" };
      const num = Math.round(Number(value));
      return { ...prev, [key]: Number.isFinite(num) ? num : "" };
    });
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || saving) return;

    const entries = Object.entries(draft) as Array<[keyof RetentionConfig, number | ""]>;
    if (entries.some(([, value]) => value === "" || !Number.isInteger(value) || value <= 0)) {
      setSaveError("Every field must be a positive whole number.");
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaveOk(false);
    try {
      const res = await fetch("/api/admin/retention", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Unable to save retention settings.");
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3500);
      await load(true);
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : "Unable to save retention settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="staff-page-loading" role="status">
        <Loader2 size={24} className="spin" aria-hidden="true" />
        <span>Loading data retention settings…</span>
      </div>
    );
  }

  if (error || !draft) {
    return (
      <div className="staff-empty-state error">
        <AlertCircle size={28} aria-hidden="true" />
        <h3>Couldn’t load retention settings</h3>
        <p>{error || "Unknown error."}</p>
        <button type="button" onClick={() => load()}><RefreshCw size={15} aria-hidden="true" /> Try again</button>
      </div>
    );
  }

  return (
    <div className="staff-page">
      <section className="staff-summary" aria-label="Last cleanup run">
        <div className="staff-summary-card">
          <span className="staff-summary-icon total"><Trash2 size={20} aria-hidden="true" /></span>
          <span><strong>{lastRun ? lastRun.deletedJobs : "—"}</strong><small>Abandoned carts removed</small></span>
        </div>
        <div className="staff-summary-card">
          <span className="staff-summary-icon admins"><FileClock size={20} aria-hidden="true" /></span>
          <span><strong>{lastRun ? lastRun.jobFilesRemoved : "—"}</strong><small>Job files purged</small></span>
        </div>
        <div className="staff-summary-card">
          <span className="staff-summary-icon owners"><ShieldAlert size={20} aria-hidden="true" /></span>
          <span><strong>{lastRun ? lastRun.strayFilesRemoved : "—"}</strong><small>Stray files removed</small></span>
        </div>
      </section>

      <section className="staff-invite-card" aria-labelledby="last-run-title">
        <div className="staff-section-heading">
          <span className="staff-section-icon"><History size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="last-run-title">Last cleanup run</h2>
            <p>Automatic cleanup runs on a schedule and purges data older than the limits below.</p>
          </div>
        </div>
        {lastRun ? (
          <p className="staff-role-help">
            Ran {formatDate(lastRun.ranAt)} — removed {lastRun.deletedJobs} abandoned cart{lastRun.deletedJobs === 1 ? "" : "s"},
            purged {lastRun.jobFilesRemoved} job file{lastRun.jobFilesRemoved === 1 ? "" : "s"}, and cleared{" "}
            {lastRun.strayFilesRemoved} stray file{lastRun.strayFilesRemoved === 1 ? "" : "s"}.
          </p>
        ) : (
          <p className="staff-role-help">No cleanup run has been recorded yet.</p>
        )}
      </section>

      <section className="staff-invite-card" aria-labelledby="retention-settings-title">
        <div className="staff-section-heading">
          <span className="staff-section-icon"><Database size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="retention-settings-title">Retention settings</h2>
            <p>Controls how long data is kept before the cleanup job deletes it.</p>
          </div>
        </div>

        <form className="staff-invite-form retention-form" onSubmit={handleSave}>
          {FIELD_DEFS.map(({ key, label, hint, unit }) => (
            <div className="staff-field" key={key}>
              <label htmlFor={`retention-${key}`}>{label}</label>
              <div className="time-input">
                <Clock size={16} className="time-icon" aria-hidden="true" />
                <input
                  id={`retention-${key}`}
                  type="number"
                  min="1"
                  step="1"
                  value={draft[key]}
                  onChange={(event) => updateField(key, event.target.value)}
                  disabled={saving}
                />
                <span className="time-hint">{unit}</span>
              </div>
              <span className="pricing-hint">{hint}</span>
            </div>
          ))}

          <button type="submit" className="staff-invite-btn" disabled={saving}>
            {saving ? <Loader2 size={17} className="spin" aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
            {saving ? "Saving..." : "Save changes"}
          </button>
        </form>

        {saveOk && (
          <div className="staff-message success" role="status">
            <CheckCircle2 size={17} aria-hidden="true" />
            Retention settings saved.
          </div>
        )}
        {saveError && (
          <div className="staff-message error" role="alert">
            <AlertCircle size={17} aria-hidden="true" />
            {saveError}
          </div>
        )}
      </section>
    </div>
  );
}
