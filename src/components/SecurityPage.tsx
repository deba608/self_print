"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Monitor,
  ShieldCheck,
  Smartphone,
  Tablet,
  XCircle,
} from "lucide-react";
import type { LoginEvent, StaffProfile } from "@/lib/types";
import AdminManagementNav from "./AdminManagementNav";
import ManagementSkeleton from "./ui/ManagementSkeleton";

function DeviceIcon({ device }: { device: string | null }) {
  if (device === "Mobile") return <Smartphone size={14} aria-hidden="true" />;
  if (device === "Tablet") return <Tablet size={14} aria-hidden="true" />;
  return <Monitor size={14} aria-hidden="true" />;
}

function formatEventDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function LocationCell({ city, country }: { city: string | null; country: string | null }) {
  if (!city && !country) return <span className="login-event-muted">—</span>;
  return <span>{[city, country].filter(Boolean).join(", ")}</span>;
}

function StatusCell({ success, failureReason }: { success: boolean; failureReason: string | null }) {
  if (success) {
    return (
      <span className="login-status login-status--success">
        <CheckCircle2 size={13} aria-hidden="true" />
        Success
      </span>
    );
  }
  const label =
    failureReason === "invalid_credentials"
      ? "Wrong password"
      : failureReason === "not_staff"
      ? "Not staff"
      : "Failed";
  return (
    <span className="login-status login-status--fail" title={failureReason ?? undefined}>
      <XCircle size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

function SecurityTable({ events }: { events: LoginEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="management-empty">
        <ShieldCheck size={28} aria-hidden="true" />
        <h2>No login events recorded yet.</h2>
        <p>Login attempts will appear here.</p>
      </div>
    );
  }

  return (
    <div className="security-table-wrap">
      <table className="security-table">
        <thead>
          <tr>
            <th>Staff</th>
            <th>Date / Time</th>
            <th>IP</th>
            <th>Browser</th>
            <th>OS</th>
            <th>Device</th>
            <th>Location</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id}>
              <td className="security-email-cell">{ev.email}</td>
              <td className="security-date-cell">{formatEventDate(ev.loggedAt)}</td>
              <td className="login-event-mono">{ev.ip ?? "—"}</td>
              <td>{ev.browser ?? "—"}</td>
              <td>{ev.os ?? "—"}</td>
              <td className="security-device-cell">
                <DeviceIcon device={ev.device} />
                {ev.device ?? "—"}
              </td>
              <td><LocationCell city={ev.city} country={ev.country} /></td>
              <td><StatusCell success={ev.success} failureReason={ev.failureReason} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SecurityPage() {
  const [authState, setAuthState] = useState<"checking" | "ok" | "unauthorized" | "forbidden">("checking");
  const [events, setEvents] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/me", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) { setAuthState("unauthorized"); return; }
        const profile: StaffProfile = await res.json();
        if (profile.role !== "super_admin") { setAuthState("forbidden"); return; }
        setAuthState("ok");

        // Load events
        setLoading(true);
        fetch("/api/admin/login-events", { credentials: "include" })
          .then(async (evRes) => {
            if (!evRes.ok) throw new Error("Failed to load events");
            setEvents(await evRes.json());
          })
          .catch((err) => setError(err.message))
          .finally(() => setLoading(false));
      })
      .catch(() => setAuthState("unauthorized"));
  }, []);

  return (
    <AdminManagementNav title="Security log" subtitle="All admin login attempts — device, location, and outcome.">
      <main className="management-page">
        {authState === "checking" ? (
          <div className="staff-page-loading" role="status">
            <Loader2 size={24} className="spin" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        ) : authState === "unauthorized" ? (
          <div className="accounts-locked">
            <Lock size={28} aria-hidden="true" />
            <p>Your admin session has expired.</p>
            <Link href="/admin" className="btn-primary">Log in again</Link>
          </div>
        ) : authState === "forbidden" ? (
          <div className="accounts-locked">
            <Lock size={28} aria-hidden="true" />
            <p>Only owners can view security logs.</p>
            <Link href="/admin" className="btn-primary">Back to dashboard</Link>
          </div>
        ) : (
          <>

            <section className="management-workspace">
              {loading ? (
                <ManagementSkeleton rows={5} />
              ) : error ? (
                <div className="management-error" role="alert">
                  <AlertCircle size={17} aria-hidden="true" />
                  {error}
                </div>
              ) : (
                <SecurityTable events={events} />
              )}
            </section>
          </>
        )}
      </main>
    </AdminManagementNav>
  );
}
