"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight, X } from "lucide-react";
import {
  BarChart2,
  LayoutDashboard,
  ListTodo,
  MapPin,
  Printer,
  ShieldCheck,
  Users,
  UsersRound,
} from "lucide-react";

const navItems = [
  { href: "/admin", icon: LayoutDashboard, label: "Dashboard", exact: true },
  { href: "/admin/orders", icon: ListTodo, label: "Orders" },
  { href: "/admin/delivery-area", icon: MapPin, label: "Delivery Area" },
  { href: "/admin/customers", icon: UsersRound, label: "Customers" },
  { href: "/admin/accounts", icon: BarChart2, label: "Accounts" },
  { href: "/admin/staff", icon: Users, label: "Staff" },
  { href: "/admin/security", icon: ShieldCheck, label: "Security" },
];

export default function AdminSidebar({
  open,
  onClose,
  collapsed,
  onToggleCollapse,
}: {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`admin-sidebar ${open ? "mobile-open" : ""} ${collapsed ? "collapsed" : ""}`}
        aria-label="Admin navigation"
      >
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
                title={collapsed ? label : undefined}
                onClick={onClose}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        {onToggleCollapse && (
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
            <span>Collapse</span>
          </button>
        )}
      </aside>
    </>
  );
}
