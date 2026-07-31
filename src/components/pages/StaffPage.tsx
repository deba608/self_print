"use client";

import Link from "next/link";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import StaffManagement from "./StaffManagement";
import type { StaffProfile } from "@/lib/types";
import AdminManagementNav from "./AdminManagementNav";

export default function StaffPage() {
  // Mirrors AccountsPage's auth probe: fetch the current staff profile so we
  // know both whether the session is valid and which role to gate on.
  const [authState, setAuthState] = useState<"checking" | "ok" | "unauthorized">("checking");
  const [currentStaff, setCurrentStaff] = useState<StaffProfile | null>(null);

  useEffect(() => {
    fetch("/api/admin/me", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) {
          setAuthState("unauthorized");
          return;
        }
        if (res.ok) setCurrentStaff(await res.json());
        setAuthState("ok");
      })
      .catch(() => setAuthState("ok"));
  }, []);

  const isSuperAdmin = currentStaff?.role === "super_admin";

  return (
    <AdminManagementNav
      title="Staff management"
      subtitle={
        isSuperAdmin
          ? "Invite teammates, assign access, and keep your shop account secure."
          : "See who currently has access to the shop dashboard."
      }
      actions={
        currentStaff && (
          <div className="staff-current-user" aria-label={`Signed in as ${currentStaff.email}`}>
            <span className="staff-current-icon"><ShieldCheck size={16} aria-hidden="true" /></span>
            <span>
              <small>Signed in as</small>
              <strong>{currentStaff.displayName || currentStaff.email}</strong>
            </span>
          </div>
        )
      }
    >
      <main className="admin-shell accounts-shell">
        {authState === "checking" ? (
          <div className="staff-page-loading" role="status">
            <Loader2 size={24} className="spin" aria-hidden="true" />
            <span>Loading staff management…</span>
          </div>
        ) : authState === "unauthorized" ? (
          <div className="accounts-locked">
            <Lock size={28} aria-hidden="true" />
            <p>Your admin session has expired.</p>
            <Link href="/admin" className="btn-primary">Log in again</Link>
          </div>
        ) : currentStaff ? (
          <StaffManagement currentStaff={currentStaff} />
        ) : (
          <div className="accounts-locked">
            <Lock size={28} aria-hidden="true" />
            <p>We couldn’t verify your staff account.</p>
            <Link href="/admin" className="btn-primary">Return to dashboard</Link>
          </div>
        )}
      </main>
    </AdminManagementNav>
  );
}
