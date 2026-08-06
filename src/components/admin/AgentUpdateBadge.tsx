"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Download, Loader2, RefreshCw, X } from "lucide-react";
import type { AgentUpdateState } from "@/lib/db";

type UpdateResponse = {
  state: AgentUpdateState;
  latest: { version: string; kind: string; publishedAt: string; sizeKb: number | null } | null;
};

const IN_FLIGHT = ["requested", "downloading", "swapping"];
const SESSION_KEY = "sp-update-notified";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 403 || r.status === 401) return null; // not super_admin
  if (!r.ok) throw new Error("fetch failed");
  return r.json() as Promise<UpdateResponse>;
});

function relTime(iso: string | null) {
  if (!iso) return "";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export default function AgentUpdateBadge() {
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installErr, setInstallErr] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(true); // hidden until check
  const [tick, setTick] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const notifiedRef = useRef(false);

  const { data, mutate } = useSWR<UpdateResponse | null>(
    "/api/admin/agent-update",
    fetcher,
    {
      // Use a function so SWR can decide the next interval from the latest data
      // without a circular reference in the hook call.
      refreshInterval: (latest) =>
        IN_FLIGHT.includes((latest as UpdateResponse | null)?.state?.updateStatus ?? "")
          ? 5000
          : 60000,
      onSuccess: (d) => {
        if (!d) return;
        // Page-open toast: once per session when update is available
        if (
          !notifiedRef.current &&
          !sessionStorage.getItem(SESSION_KEY) &&
          d.latest &&
          d.state.agentVersion !== d.latest.version &&
          !IN_FLIGHT.includes(d.state.updateStatus ?? "")
        ) {
          notifiedRef.current = true;
          sessionStorage.setItem(SESSION_KEY, "1");
          setBannerDismissed(false);
        }
      },
    }
  );

  // 30s wall-clock tick to keep "N ago" fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Close popup on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!data) return null; // 403/401/loading → hidden

  const { state, latest } = data;
  const isInFlight = IN_FLIGHT.includes(state.updateStatus ?? "");
  const updateAvailable = latest && state.agentVersion !== latest.version;
  const isFailed = state.updateStatus === "failed" || state.updateStatus === "rolled_back";

  // Hide button if nothing to report
  if (!updateAvailable && !isInFlight && !isFailed) return null;

  // Button appearance
  let dotClass = "";
  let label = "Update";
  let title = "";
  if (isInFlight) {
    dotClass = "update-dot-progress";
    label = "Updating…";
    title = `Agent update in progress (${state.updateStatus})`;
  } else if (isFailed) {
    dotClass = "update-dot-failed";
    title = `Last update ${state.updateStatus}: ${state.updateMessage ?? ""}`;
  } else if (updateAvailable) {
    dotClass = "update-dot-available";
    title = `Agent update available: v${latest!.version}`;
  }

  async function install() {
    setInstalling(true);
    setInstallErr(null);
    try {
      const res = await fetch("/api/admin/agent-update", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).error ?? `HTTP ${res.status}`);
      }
      await mutate();
    } catch (e) {
      setInstallErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  void tick; // used for re-render on tick

  return (
    <>
      {/* Floating banner on page open */}
      {!bannerDismissed && (
        <div className="update-banner" role="alert">
          <Download size={15} />
          <span>
            Agent update available — <strong>v{latest?.version}</strong>
          </span>
          <button
            type="button"
            className="update-banner-install"
            onClick={() => { setBannerDismissed(true); setOpen(true); }}
          >
            Install
          </button>
          <button
            type="button"
            className="update-banner-close"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Topbar badge button + popup */}
      <div className="update-badge-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`action-btn action-btn-labeled update-badge-btn ${isFailed ? "update-state-failed" : ""}`}
          onClick={() => setOpen((v) => !v)}
          title={title}
          aria-expanded={open}
          aria-haspopup="true"
        >
          {isInFlight
            ? <Loader2 size={16} className="spin" />
            : <RefreshCw size={16} />}
          <span>{label}</span>
          <span className={`update-dot ${dotClass}`} aria-hidden="true" />
        </button>

        {open && (
          <div className="update-popup" role="dialog" aria-label="Agent update">
            <div className="update-popup-head">
              <span className="update-popup-title">Print Agent</span>
              <button type="button" className="update-popup-close" onClick={() => setOpen(false)} aria-label="Close">
                <X size={14} />
              </button>
            </div>

            <div className="update-popup-rows">
              <div className="update-popup-row">
                <span className="update-popup-label">Running</span>
                <span className="update-popup-val">
                  {state.agentVersion ?? "—"}
                  {state.agentHealthyAt && (
                    <span className="update-popup-sub"> · healthy · {relTime(state.agentHealthyAt)}</span>
                  )}
                </span>
              </div>
              {latest && (
                <div className="update-popup-row">
                  <span className="update-popup-label">Available</span>
                  <span className="update-popup-val">
                    v{latest.version}
                    <span className="update-popup-sub">
                      {" "}· {latest.kind}{latest.sizeKb ? ` · ${latest.sizeKb} KB` : ""}
                    </span>
                  </span>
                </div>
              )}
              {state.updateStatus && (
                <div className="update-popup-row">
                  <span className="update-popup-label">Status</span>
                  <span className={`update-popup-val ${isFailed ? "update-popup-failed" : ""}`}>
                    {state.updateStatus}
                    {state.updateMessage && (
                      <span className="update-popup-sub"> — {state.updateMessage}</span>
                    )}
                  </span>
                </div>
              )}
            </div>

            {installErr && (
              <div className="update-popup-err">{installErr}</div>
            )}

            {updateAvailable && !isInFlight && (
              <button
                type="button"
                className="update-popup-install-btn"
                onClick={install}
                disabled={installing}
              >
                {installing ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                {installing ? "Installing…" : `Install v${latest!.version}`}
              </button>
            )}

            {isInFlight && (
              <div className="update-popup-progress">
                <Loader2 size={13} className="spin" />
                Update in progress — checking every 5s…
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
