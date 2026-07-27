"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Loader2, LogOut, Menu } from "lucide-react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { useSidebarCollapse } from "@/hooks/useSidebarCollapse";

/**
 * Shared page shell for every /admin/* management page (Orders, Customers,
 * Accounts, Staff, Security, job detail, manual print). Owns the sidebar
 * (desktop, collapsible) + mobile drawer + a slim topbar with just a
 * hamburger and logout — matches the main dashboard's admin-layout grid so
 * every admin page shares one consistent nav instead of two different ones.
 */
export default function AdminManagementNav({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { collapsed, toggle: toggleCollapsed } = useSidebarCollapse();

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
    <div className={`admin-layout management-page-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      <AdminSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />
      <header className="admin-topbar">
        <div className="admin-topbar-inner">
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu size={20} />
          </button>
          <div className="admin-topbar-spacer" />
          <button type="button" className="management-logout" onClick={logout} disabled={loggingOut}>
            {loggingOut
              ? <Loader2 size={16} className="spin" aria-hidden="true" />
              : <LogOut size={16} aria-hidden="true" />}
            <span>{loggingOut ? "Signing out" : "Log out"}</span>
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
