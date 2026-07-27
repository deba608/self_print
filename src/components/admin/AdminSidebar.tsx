"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import {
  BarChart2,
  LayoutDashboard,
  ListTodo,
  Printer,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react";

const navItems = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { href: "/admin/orders", icon: ListTodo, label: "Orders" },
  { href: "/admin/customers", icon: UsersRound, label: "Customers" },
  { href: "/admin/accounts", icon: BarChart2, label: "Accounts" },
  { href: "/admin/staff", icon: Users, label: "Staff" },
  { href: "/admin/security", icon: ShieldCheck, label: "Security" },
];

export default function AdminSidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />}
      <aside className={`admin-sidebar ${open ? "mobile-open" : ""}`} aria-label="Admin navigation">
        <div className="sidebar-brand">
          <Printer size={20} strokeWidth={1.5} />
          <span>SelfPrint</span>
          <button type="button" className="sidebar-close-btn" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(({ href, icon: Icon, label, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`sidebar-link ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={onClose}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
