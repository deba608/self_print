"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Lock,
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
  role: "super_admin" | "admin" | "delivery";
  invitedBy: string | null;
  createdAt: string;
};

function roleLabel(role: StaffRow["role"]) {
  return role === "super_admin" ? "Owner" : role === "delivery" ? "Delivery" : "Admin";
}

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
  const [role, setRole] = useState<"admin" | "super_admin" | "delivery">("admin");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteOk, setInviteOk] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [expandedLoginId, setExpandedLoginId] = useState<string | null>(null);
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);

  // Create account form state
  const [createMode, setCreateMode] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createRole, setCreateRole] = useState<"admin" | "super_admin" | "delivery">("admin");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createOk, setCreateOk] = useState(false);

  const isSuperAdmin = currentStaff.role === "super_admin";
  const superAdminCount = staff.filter((member) => member.role === "super_admin").length;

  // silent=true refreshes in the background without swapping the rendered
  // list for skeletons — used after invite/create/revoke so the table doesn't
  // flash blank on every action.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/staff", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load staff members.");
      const body = await res.json();
      setStaff(body.staff ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load staff members.");
    } finally {
      if (!silent) setLoading(false);
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
      await load(true);
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

  async function handleRoleChange(member: StaffRow) {
    if (roleChangingId) return;
    const newRole = member.role === "super_admin" ? "admin" : "super_admin";
    // Prevent demoting the last super admin
    if (newRole === "admin" && member.role === "super_admin" && superAdminCount <= 1) {
      setRevokeError("Cannot demote the last owner.");
      return;
    }
    setRoleChangingId(member.id);
    setRevokeError("");
    try {
      const res = await fetch(`/api/admin/staff/${member.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Unable to change role.");
      setStaff((previous) =>
        previous.map((m) => (m.id === member.id ? { ...m, role: newRole } : m))
      );
    } catch (roleFailure) {
      setRevokeError(roleFailure instanceof Error ? roleFailure.message : "Unable to change role.");
    } finally {
      setRoleChangingId(null);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError("");
    setCreateOk(false);
    try {
      const res = await fetch("/api/admin/staff/create", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: createEmail.trim(),
          password: createPassword,
          displayName: createDisplayName.trim(),
          role: createRole,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Unable to create account.");
      setCreateEmail("");
      setCreatePassword("");
      setCreateDisplayName("");
      setCreateRole("admin");
      setCreateOk(true);
      setTimeout(() => setCreateOk(false), 3500);
      await load(true);
    } catch (createFailure) {
      setCreateError(createFailure instanceof Error ? createFailure.message : "Unable to create account.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="staff-page">
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
              <h2 id="invite-staff-title">Add staff</h2>
              <p>Invite via email or create an account directly.</p>
            </div>
          </div>

          <div className="staff-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              className={`staff-mode-tab ${!createMode ? "active" : ""}`}
              onClick={() => { setCreateMode(false); setCreateError(""); setCreateOk(false); }}
              aria-selected={!createMode}
            >
              <Mail size={14} aria-hidden="true" />
              Invite
            </button>
            <button
              type="button"
              role="tab"
              className={`staff-mode-tab ${createMode ? "active" : ""}`}
              onClick={() => { setCreateMode(true); setInviteError(""); setInviteOk(false); }}
              aria-selected={createMode}
            >
              <UserPlus size={14} aria-hidden="true" />
              Create account
            </button>
          </div>

          {!createMode ? (
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
                  onChange={(event) => setRole(event.target.value as "admin" | "super_admin" | "delivery")}
                  disabled={inviting}
                >
                  <option value="admin">Admin</option>
                  <option value="super_admin">Owner</option>
                  <option value="delivery">Delivery</option>
                </select>
              </div>

              <button type="submit" className="staff-invite-btn" disabled={inviting || !email.trim()}>
                {inviting ? <Loader2 size={17} className="spin" aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}
                {inviting ? "Sending invite..." : "Send invite"}
              </button>
            </form>
          ) : (
            <form className="staff-invite-form staff-create-form" onSubmit={handleCreate}>
              <div className="staff-field staff-email-field">
                <label htmlFor="create-email">Email</label>
                <div className="staff-input-wrap">
                  <Mail size={17} aria-hidden="true" />
                  <input
                    id="create-email"
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={createEmail}
                    onChange={(event) => setCreateEmail(event.target.value)}
                    autoComplete="email"
                    disabled={creating}
                  />
                </div>
              </div>

              <div className="staff-field">
                <label htmlFor="create-password">Password</label>
                <div className="staff-input-wrap">
                  <Lock size={17} aria-hidden="true" />
                  <input
                    id="create-password"
                    type="password"
                    required
                    placeholder="Min. 6 characters"
                    value={createPassword}
                    onChange={(event) => setCreatePassword(event.target.value)}
                    autoComplete="new-password"
                    disabled={creating}
                    minLength={6}
                  />
                </div>
              </div>

              <div className="staff-field">
                <label htmlFor="create-name">Display name (optional)</label>
                <div className="staff-input-wrap">
                  <Users size={17} aria-hidden="true" />
                  <input
                    id="create-name"
                    type="text"
                    placeholder="John"
                    value={createDisplayName}
                    onChange={(event) => setCreateDisplayName(event.target.value)}
                    disabled={creating}
                  />
                </div>
              </div>

              <div className="staff-field">
                <label htmlFor="create-role">Access level</label>
                <select
                  id="create-role"
                  value={createRole}
                  onChange={(event) => setCreateRole(event.target.value as "admin" | "super_admin" | "delivery")}
                  disabled={creating}
                >
                  <option value="admin">Admin</option>
                  <option value="super_admin">Owner</option>
                  <option value="delivery">Delivery</option>
                </select>
              </div>

              <button type="submit" className="staff-invite-btn" disabled={creating || !createEmail.trim() || createPassword.length < 6}>
                {creating ? <Loader2 size={17} className="spin" aria-hidden="true" /> : <UserPlus size={17} aria-hidden="true" />}
                {creating ? "Creating..." : "Create account"}
              </button>
            </form>
          )}

          <p className="staff-role-help">
            {(() => {
              const selected = !createMode ? role : createRole;
              if (selected === "delivery") return "Delivery riders can only see and complete delivery orders.";
              if (selected === "admin") return "Admins can manage print jobs, pricing, accounts, and view staff.";
              return "Owners can do everything an admin can, plus invite and remove staff.";
            })()}
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
          {createOk && (
            <div className="staff-message success" role="status">
              <CheckCircle2 size={17} aria-hidden="true" />
              Account created successfully.
            </div>
          )}
          {createError && (
            <div className="staff-message error" role="alert">
              <AlertCircle size={17} aria-hidden="true" />
              {createError}
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
          <button type="button" className="staff-refresh-btn" onClick={() => load()} disabled={loading}>
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
            <button type="button" onClick={() => load()}><RefreshCw size={15} aria-hidden="true" /> Try again</button>
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
                        {isSuperAdmin && !isCurrentUser && member.role !== "delivery" ? (
                          <button
                            type="button"
                            className={`staff-role-badge staff-role-toggle ${member.role}`}
                            onClick={() => handleRoleChange(member)}
                            disabled={roleChangingId === member.id}
                            title={member.role === "super_admin" ? "Demote to Admin" : "Promote to Owner"}
                          >
                            {roleChangingId === member.id && <Loader2 size={11} className="spin" aria-hidden="true" />}
                            {roleLabel(member.role)}
                          </button>
                        ) : (
                          <span className={`staff-role-badge ${member.role}`}>
                            {roleLabel(member.role)}
                          </span>
                        )}
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
