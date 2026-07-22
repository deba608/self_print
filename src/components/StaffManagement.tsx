"use client";

import { useState, useEffect, useCallback } from "react";
import { UserPlus, Trash2, Loader2, ShieldCheck, Users } from "lucide-react";
import type { StaffProfile } from "@/lib/types";

type StaffRow = {
  id: string;
  email: string;
  displayName: string | null;
  role: "super_admin" | "admin";
  invitedBy: string | null;
  createdAt: string;
};

export default function StaffManagement({ currentStaff }: { currentStaff: StaffProfile | null }) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "super_admin">("admin");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteOk, setInviteOk] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const isSuperAdmin = currentStaff?.role === "super_admin";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/staff", { credentials: "include" });
      if (!res.ok) throw new Error("Unable to load staff");
      const body = await res.json();
      setStaff(body.staff ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load staff");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
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
      if (!res.ok) throw new Error(body.error ?? "Unable to invite staff member");
      setEmail("");
      setRole("admin");
      setInviteOk(true);
      setTimeout(() => setInviteOk(false), 2500);
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to invite staff member");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/admin/staff/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        setConfirmRevoke(null);
        setStaff((prev) => prev.filter((s) => s.id !== id));
      }
    } finally {
      setRevokingId(null);
    }
  }

  if (!currentStaff) return null;

  return (
    <div className="acct-root">
      <div className="acct-header">
        <div className="acct-title-row">
          <div className="acct-title-icon"><Users size={22} /></div>
          <div>
            <h1>Staff Management</h1>
            <p className="acct-title-sub">
              {isSuperAdmin ? "Invite and manage admin accounts" : "View staff members"}
            </p>
          </div>
        </div>
      </div>

      {isSuperAdmin && (
        <section>
          <p className="acct-section-label">Invite Staff</p>
          <form className="pricing-grid" onSubmit={handleInvite}>
            <div className="pricing-field">
              <label htmlFor="staff-email">Email</label>
              <input
                id="staff-email"
                type="email"
                required
                placeholder="staff@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="pricing-field">
              <label htmlFor="staff-role">Role</label>
              <select
                id="staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "admin" | "super_admin")}
              >
                <option value="admin">admin</option>
                <option value="super_admin">super_admin</option>
              </select>
            </div>
            <div className="pricing-field" style={{ justifyContent: "flex-end" }}>
              <button type="submit" className="btn-primary" disabled={inviting}>
                {inviting ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Inviting...
                  </>
                ) : inviteOk ? (
                  "Invited!"
                ) : (
                  <>
                    <UserPlus size={16} />
                    Send Invite
                  </>
                )}
              </button>
            </div>
          </form>
          {inviteError && <p className="panel-error" role="alert">{inviteError}</p>}
        </section>
      )}

      <section className="acct-table-section">
        <p className="acct-section-label">Current Staff</p>
        {loading ? (
          <div className="acct-loading">
            <Loader2 size={24} className="spin" />
          </div>
        ) : error ? (
          <div className="acct-error">
            <p>{error}</p>
          </div>
        ) : staff.length === 0 ? (
          <div className="acct-table-empty">No staff members found.</div>
        ) : (
          <div className="acct-table-wrapper">
            <table className="acct-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  {isSuperAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td>{s.email}</td>
                    <td>
                      <span className={`status-badge ${s.role === "super_admin" ? "ready" : "info"}`}>
                        {s.role === "super_admin" && <ShieldCheck size={12} aria-hidden="true" />}
                        {s.role}
                      </span>
                    </td>
                    <td className="date-cell">{new Date(s.createdAt).toLocaleDateString()}</td>
                    {isSuperAdmin && (
                      <td>
                        {s.id === currentStaff.id ? null : confirmRevoke === s.id ? (
                          <span className="manage-confirm-actions">
                            <button type="button" className="btn-secondary" onClick={() => setConfirmRevoke(null)}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="job-btn cancel"
                              onClick={() => handleRevoke(s.id)}
                              disabled={revokingId === s.id}
                            >
                              {revokingId === s.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                              Confirm
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="job-btn cancel"
                            onClick={() => setConfirmRevoke(s.id)}
                            aria-label={`Revoke ${s.email}`}
                          >
                            <Trash2 size={14} />
                            Revoke
                          </button>
                        )}
                      </td>
                    )}
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
