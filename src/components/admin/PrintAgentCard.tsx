"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { useCurrentStaff } from "@/hooks/useAdmin";
import type { AgentUpdateState } from "@/lib/db";

type AgentUpdateResponse = {
  state: AgentUpdateState;
  latest: { version: string; kind: string; publishedAt: string; sizeKb: number | null } | null;
};

// Mid-upgrade statuses: the agent owns the flow until it lands on
// success/failed/rolled_back, so the button stays disabled and we poll.
const IN_FLIGHT = ["requested", "downloading", "swapping"];

// The agent heartbeats every ~2.5 min; two missed beats is our "offline" line.
const HEALTHY_WINDOW_MS = 5 * 60 * 1000;

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((res) => {
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  });

/**
 * Timestamps arrive as SQLite ISO-Z or Postgres timestamptz depending on the
 * backing database, so parse defensively and render nothing rather than
 * "Invalid Date" when a value is missing or unparseable.
 */
function relativeTime(value: string | null | undefined): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function isHealthy(healthyAt: string | null): boolean {
  if (!healthyAt) return false;
  const then = new Date(healthyAt).getTime();
  if (!Number.isFinite(then)) return false;
  return Date.now() - then < HEALTHY_WINDOW_MS;
}

export default function PrintAgentCard() {
  // Same role signal the management pages use. The card is super_admin-only,
  // matching the API — an admin never fires the GET, so its 403 can't be
  // mistaken for an expired session by anything watching fetch failures.
  const { data: staff } = useCurrentStaff();
  const isSuperAdmin = staff?.role === "super_admin";

  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  // Wall-clock tick. The poll alone can't keep the age readouts honest: when
  // the agent is dead the payload never changes, SWR sees a structurally equal
  // response and skips the re-render, so "healthy / just now" would stay frozen
  // on screen. This forces a re-render every 30s regardless of the data.
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  // 5s while the agent is mid-upgrade; 60s otherwise. The resting poll is not
  // optional: healthy/relative-time are computed at render, so without it an
  // open modal would keep showing a long-dead agent as "healthy, just now".
  const { data, error: loadError, isLoading, mutate } = useSWR<AgentUpdateResponse>(
    isSuperAdmin ? "/api/admin/agent-update" : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: (latest) =>
        IN_FLIGHT.includes(latest?.state?.updateStatus ?? "") ? 5000 : 60000 }
  );

  if (!isSuperAdmin) return null;

  const state = data?.state;
  const latest = data?.latest ?? null;
  const status = state?.updateStatus ?? null;
  const inFlight = IN_FLIGHT.includes(status ?? "");
  const running = state?.agentVersion ?? null;
  // Nothing to offer when no manifest is published, or the agent is already
  // on the published build.
  const showAvailable = latest !== null && latest.version !== running;
  const lastEvent = state?.lastEvent ?? null;
  const eventFailed = lastEvent?.status === "failed" || lastEvent?.status === "rolled_back";

  const install = async () => {
    setPosting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/agent-update", {
        method: "POST",
        credentials: "include",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Unable to start the update.");
      await mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start the update.");
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="agent-update-card">
      <div className="agent-update-head">
        <RefreshCw size={16} aria-hidden="true" />
        <h3>Print agent</h3>
      </div>

      {isLoading && !data ? (
        <div className="agent-update-loading" role="status">
          <Loader2 size={16} className="spin" aria-hidden="true" />
          <span>Checking agent version…</span>
        </div>
      ) : loadError && !data ? (
        // A failed GET with nothing cached must not render as "unknown /
        // offline" — that would report a network problem as a dead agent.
        // With cached data we keep the card and flag it as possibly stale,
        // so one dropped background poll can't blank an active install.
        <p className="agent-update-error" role="alert">Couldn’t load agent status.</p>
      ) : (
        <>
          <div className="agent-update-row">
            <span className="agent-update-label">Running</span>
            <span className="agent-update-value">{running ?? "unknown"}</span>
            {isHealthy(state?.agentHealthyAt ?? null) ? (
              <span className="agent-badge healthy">healthy</span>
            ) : (
              <span className="agent-badge offline">offline</span>
            )}
            {state?.agentHealthyAt && (
              <span className="agent-update-time">{relativeTime(state.agentHealthyAt)}</span>
            )}
          </div>

          {showAvailable && (
            <div className="agent-update-row">
              <span className="agent-update-label">Available</span>
              <span className="agent-update-value">{latest.version}</span>
              {latest.sizeKb !== null && (
                <span className="agent-update-time">{latest.sizeKb} KB</span>
              )}
            </div>
          )}

          {/* Nothing to install: say so, rather than showing a greyed-out
              button with no explanation. */}
          {!showAvailable && !inFlight ? (
            <p className="agent-update-uptodate">Up to date.</p>
          ) : (
            <button
              type="button"
              className="btn-primary agent-update-btn"
              onClick={install}
              disabled={inFlight || posting}
            >
              {inFlight ? (
                <>
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                  Installing… ({status})
                </>
              ) : posting ? (
                <>
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                  Starting…
                </>
              ) : (
                <>
                  <Download size={16} aria-hidden="true" />
                  Install update
                </>
              )}
            </button>
          )}

          {loadError && (
            <p className="agent-update-stale">Status may be stale — couldn’t refresh.</p>
          )}

          {lastEvent && (
            <p className={`agent-update-last ${eventFailed ? "failed" : ""}`}>
              Last update: {lastEvent.toVersion ?? "unknown"} — {lastEvent.status}
              {lastEvent.createdAt ? `, ${relativeTime(lastEvent.createdAt)}` : ""}
              {eventFailed && lastEvent.message ? ` — ${lastEvent.message}` : ""}
            </p>
          )}

          {error && <p className="agent-update-error" role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
