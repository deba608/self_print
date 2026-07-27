"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Mail,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Tablet,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import type { LoginEvent, StaffProfile } from "@/lib/types";

type StaffRow = {
  id: string;
  email: string;
  displayName: string | null;
  role: "super_admin" | "admin";
  invitedBy: string | null;
  createdAt: string;
};

function getInitials(staff: StaffRow) {
  const source = staff.displayName?.trim() || staff.email.split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S";
}

function formatJoinedDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatEventDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeviceIcon({ device }: { device: string | null }) {
  if (device === "Mobile") return <Smartphone size={13} aria-hidden="true" />;
  if (device === "Tablet") return <Tablet size={13} aria-hidden="true" />;
  return <Monitor size={13} aria-hidden="true" />;
}

function LoginHistoryPanel({ staffId }: { staffId: string }) {
  const [events, setEvents] = useState<LoginEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/admin/login-events?staffId=${staffId}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load");
        setEvents(await res.json());
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [staffId]);

  if (loading) {
    return (
      <div className="staff-login-history-loading">
        <Loader2 size={14} className="spin" aria-hidden="true" />
        Loading login history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="staff-login-history-empty">
        <AlertCircle size={16} aria-hidden="true" />
        {error}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="staff-login-history-empty">
        <ShieldCheck size={16} aria-hidden="true" />
        No login events yet.
      </div>
    );
  }

  return (
    <div className="staff-login-history-table-wrap">
      <table className="staff-login-history-table">
        <thead>
          <tr>
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
              <td className="security-date-cell">{formatEventDate(ev.loggedAt)}</td>
              <td className="login-event-mono">{ev.ip ?? "—"}</td>
              <td>{ev.browser ?? "—"}</td>
              <td>{ev.os ?? "—"}</td>
              <td className="security-device-cell">
                <DeviceIcon device={ev.device} />
                {ev.device ?? "—"}
              </td>
              <td>
                {ev.city || ev.country
                  ? [ev.city, ev.country].filter(Boolean).join(", ")
                  : <span className="login-event-muted">—</span>}
              </td>
              <td>
                {ev.success ? (
                  <span className="login-status login-status--success">
                    <CheckCircle2 size={12} aria-hidden="true" /> Success
                  </span>
                ) : (
                  <span className="login-status login-status--fail">
                    <XCircle size={12} aria-hidden="true" />
                    {ev.failureReason === "invalid_credentials"
                      ? "Wrong password"
                      : ev.failureReason === "not_staff"
                      ? "Not staff"
                      : "Failed"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function StaffManagement({ currentStaff }: { currentStaff: StaffProfile }) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "super_admin">("admin");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteOk, setInviteOk] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [expandedLoginId, setExpandedLoginId] = useState<string | null>(null);

  const isSuperAdmin = currentStaff.role === "super_admin";
  const superAdminCount = staff.filter((member) => member.role === "super_admin").length;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/staff", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load staff members.");
      const body = await res.json();
      setStaff(body.staff ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load staff members.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || inviting) return;
    setInviting(true);
    setInviteError("");
    setInviteOk(false);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Unable to invite staff member.");
      setEmail("");
      setRole("admin");
      setInviteOk(true);
      setTimeout(() => setInviteOk(false), 3500);
      await load();
    } catch (inviteFailure) {
      setInviteError(inviteFailure instanceof Error ? inviteFailure.message : "Unable to invite staff member.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    setRevokeError("");
    try {
      const res = await fetch(`/api/admin/staff/${id}`, { method: "DELETE", credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Unable to revoke this staff member.");
      setConfirmRevoke(null);
      setStaff((previous) => previous.filter((member) => member.id !== id));
    } catch (revokeFailure) {
      setRevokeError(revokeFailure instanceof Error ? revokeFailure.message : "Unable to revoke this staff member.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="staff-page">
      <header className="staff-hero">
        <div className="staff-hero-copy">
          <span className="staff-eyebrow">Access control</span>
          <h1>Staff management</h1>
          <p>
            {isSuperAdmin
              ? "Invite teammates, assign access, and keep your shop account secure."
              : "See who currently has access to the shop dashboard."}
          </p>
        </div>
        <div className="staff-current-user" aria-label={`Signed in as ${currentStaff.email}`}>
          <span className="staff-current-icon"><ShieldCheck size={18} aria-hidden="true" /></span>
          <span>
            <small>Signed in as</small>
            <strong>{currentStaff.displayName || currentStaff.email}</strong>
          </span>
        </div>
      </header>

      <section className="staff-summary" aria-label="Staff summary">
        <div className="staff-summary-card">
          <span className="staff-summary-icon total"><Users size={20} aria-hidden="true" /></span>
          <span><strong>{loading ? "—" : staff.length}</strong><small>Total staff</small></span>
        </div>
        <div className="staff-summary-card">
          <span className="staff-summary-icon admins"><UserCog size={20} aria-hidden="true" /></span>
          <span><strong>{loading ? "—" : staff.length - superAdminCount}</strong><small>Admins</small></span>
        </div>
        <div className="staff-summary-card">
          <span className="staff-summary-icon owners"><ShieldCheck size={20} aria-hidden="true" /></span>
          <span><strong>{loading ? "—" : superAdminCount}</strong><small>Owners</small></span>
        </div>
      </section>

      {isSuperAdmin && (
        <section className="staff-invite-card" aria-labelledby="invite-staff-title">
          <div className="staff-section-heading">
            <span className="staff-section-icon"><UserPlus size={20} aria-hidden="true" /></span>
            <div>
              <h2 id="invite-staff-title">Invite a staff member</h2>
              <p>They’ll receive an email to create their password and join this shop.</p>
            </div>
          </div>

          <form className="staff-invite-form" onSubmit={handleInvite}>
            <div className="staff-field staff-email-field">
              <label htmlFor="staff-email">Work email</label>
              <div className="staff-input-wrap">
                <Mail size={17} aria-hidden="true" />
                <input
                  id="staff-email"
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  disabled={inviting}
                />
              </div>
            </div>

            <div className="staff-field">
              <label htmlFor="staff-role">Access level</label>
              <select
                id="staff-role"
                value={role}
                onChange={(event) => setRole(event.target.value as "admin" | "super_admin")}
                disabled={inviting}
              >
                <option value="admin">Admin</option>
                <option value="super_admin">Owner</option>
              </select>
            </div>

            <button type="submit" className="staff-invite-btn" disabled={inviting || !email.trim()}>
              {inviting ? <Loader2 size={17} className="spin" aria-hidden="true" /> : <UserPlus size={17} aria-hidden="true" />}
              {inviting ? "Sending invite..." : "Send invite"}
            </button>
          </form>

          <p className="staff-role-help">
            {role === "admin"
              ? "Admins can manage print jobs, pricing, accounts, and view staff."
              : "Owners can do everything an admin can, plus invite and remove staff."}
          </p>

          {inviteOk && (
            <div className="staff-message success" role="status">
              <CheckCircle2 size={17} aria-hidden="true" />
              Invitation sent successfully.
            </div>
          )}
          {inviteError && (
            <div className="staff-message error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              {inviteError}
            </div>
          )}
        </section>
      )}

      <section className="staff-list-section" aria-labelledby="staff-list-title">
        <div className="staff-list-header">
          <div>
            <h2 id="staff-list-title">People with access</h2>
            <p>{loading ? "Loading staff…" : `${staff.length} ${staff.length === 1 ? "person" : "people"} can access this dashboard`}</p>
          </div>
          <button type="button" className="staff-refresh-btn" onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" />
            Refresh
          </button>
        </div>

        {revokeError && (
          <div className="staff-message error staff-list-message" role="alert">
            <AlertCircle size={17} aria-hidden="true" />
            {revokeError}
          </div>
        )}

        {loading ? (
          <div className="staff-loading-list" aria-busy="true" aria-label="Loading staff members">
            {[0, 1, 2].map((item) => <div key={item} className="staff-row-skeleton" />)}
          </div>
        ) : error ? (
          <div className="staff-empty-state error">
            <AlertCircle size={28} aria-hidden="true" />
            <h3>Couldn’t load staff</h3>
            <p>{error}</p>
            <button type="button" onClick={load}><RefreshCw size={15} aria-hidden="true" /> Try again</button>
          </div>
        ) : staff.length === 0 ? (
          <div className="staff-empty-state">
            <Users size={28} aria-hidden="true" />
            <h3>No staff members yet</h3>
            <p>Invite your first teammate to help manage print orders.</p>
          </div>
        ) : (
          <ul className="staff-member-list">
            {staff.map((member) => {
              const isCurrentUser = member.id === currentStaff.id;
              const isConfirming = confirmRevoke === member.id;
              const isExpanded = expandedLoginId === member.id;
              return (
                <li key={member.id} className={`staff-member-card${isCurrentUser ? " is-current" : ""}`}>
                  <div className="staff-member-main">
                    <span className={`staff-avatar ${member.role}`}>
                      {getInitials(member)}
                    </span>

                    <div className="staff-member-identity">
                      <div className="staff-member-name">
                        <strong>{member.displayName || member.email.split("@")[0]}</strong>
                        {isCurrentUser && <span className="staff-you-badge">(You)</span>}
                        <span className={`staff-role-badge ${member.role}`}>
                          {member.role === "super_admin" ? "Owner" : "Admin"}
                        </span>
                      </div>
                      <span className="staff-member-email">{member.email}</span>
                    </div>

                    <div className="staff-member-meta">
                      <span className="staff-joined-date">
                        <CalendarDays size={13} aria-hidden="true" />
                        Joined {formatJoinedDate(member.createdAt)}
                      </span>
                    </div>

                    {isSuperAdmin && !isCurrentUser && (
                      <div className="staff-member-actions">
                        {isConfirming ? (
                          <div className="staff-revoke-confirm" role="group" aria-label={`Confirm removal of ${member.email}`}>
                            <span>Remove access?</span>
                            <button type="button" className="staff-cancel-btn" onClick={() => setConfirmRevoke(null)} disabled={revokingId === member.id}>
                              Cancel
                            </button>
                            <button type="button" className="staff-revoke-confirm-btn" onClick={() => handleRevoke(member.id)} disabled={revokingId === member.id}>
                              {revokingId === member.id && <Loader2 size={14} className="spin" aria-hidden="true" />}
                              {revokingId === member.id ? "Removing..." : "Remove"}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="staff-revoke-btn"
                            onClick={() => { setConfirmRevoke(member.id); setRevokeError(""); }}
                            aria-label={`Remove access for ${member.email}`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isSuperAdmin && (
                    <div className="staff-member-history">
                      <button
                        type="button"
                        className="staff-history-toggle"
                        onClick={() =>
                          setExpandedLoginId(isExpanded ? null : member.id)
                        }
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronUp size={13} aria-hidden="true" />
                        ) : (
                          <ChevronDown size={13} aria-hidden="true" />
                        )}
                        {isExpanded ? "Hide login history" : "Show login history"}
                      </button>

                      {isExpanded && (
                        <div className="staff-login-history">
                          <LoginHistoryPanel staffId={member.id} />
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
