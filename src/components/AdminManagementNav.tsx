"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  LayoutDashboard,
  ListTodo,
  Loader2,
  LogOut,
  Printer,
  UsersRound,
  UserRoundCog,
} from "lucide-react";

const managementLinks = [
  { href: "/admin/orders", label: "Orders", icon: ListTodo },
  { href: "/admin/customers", label: "Customers", icon: UsersRound },
  { href: "/admin/accounts", label: "Accounts", icon: BarChart3 },
  { href: "/admin/staff", label: "Staff", icon: UserRoundCog },
] as const;

export default function AdminManagementNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    } finally {
      router.replace("/admin");
      router.refresh();
    }
  }

  return (
    <header className="management-nav">
      <div className="management-nav-inner">
        <Link href="/admin" className="management-brand" aria-label="Back to admin queue">
          <span className="management-brand-mark"><Printer size={20} aria-hidden="true" /></span>
          <span>
            <strong>SelfPrint</strong>
            <small>Operations</small>
          </span>
        </Link>

        <nav className="management-tabs" aria-label="Admin management">
          <Link href="/admin" className={pathname === "/admin" ? "active" : ""}>
            <LayoutDashboard size={16} aria-hidden="true" />
            <span>Queue</span>
          </Link>
          {managementLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={pathname.startsWith(href) ? "active" : ""}>
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <button
          type="button"
          className="management-logout"
          onClick={logout}
          disabled={loggingOut}
        >
          {loggingOut
            ? <Loader2 size={16} className="spin" aria-hidden="true" />
            : <LogOut size={16} aria-hidden="true" />}
          <span>{loggingOut ? "Signing out" : "Log out"}</span>
        </button>
      </div>
    </header>
  );
}
