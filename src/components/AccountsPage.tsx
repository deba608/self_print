"use client";

import Link from "next/link";
import { ChevronLeft, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import AccountsTab from "./AccountsTab";

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
    <main className="admin-shell accounts-shell">
      <Link href="/admin" className="back-link">
        <ChevronLeft size={18} />
        <span>Back to Queue</span>
      </Link>

      {authState === "unauthorized" ? (
        <div className="accounts-locked">
          <Lock size={28} aria-hidden="true" />
          <p>Your admin session has expired.</p>
          <Link href="/login" className="btn-primary">Log in again</Link>
        </div>
      ) : (
        <AccountsTab />
      )}
    </main>
  );
}
