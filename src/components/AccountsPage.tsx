"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import AccountsTab from "./AccountsTab";
import AdminManagementNav from "./AdminManagementNav";

export default function AccountsPage() {
  // A lightweight auth probe so an expired/missing admin session shows a
  // clear "please log in" state instead of AccountsTab's generic error.
  const [authState, setAuthState] = useState<"checking" | "ok" | "unauthorized">("checking");

  useEffect(() => {
    fetch("/api/admin/summary", { credentials: "include" })
      .then((res) => setAuthState(res.status === 401 ? "unauthorized" : "ok"))
      .catch(() => setAuthState("ok")); // network hiccup — let AccountsTab surface its own error
  }, []);

  return (
    <AdminManagementNav>
      <main className="admin-shell accounts-shell">
        {authState === "unauthorized" ? (
          <div className="accounts-locked">
            <Lock size={28} aria-hidden="true" />
            <p>Your admin session has expired.</p>
            <Link href="/admin" className="btn-primary">Log in again</Link>
          </div>
        ) : (
          <AccountsTab />
        )}
      </main>
    </AdminManagementNav>
  );
}
