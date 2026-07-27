"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="admin-sidebar" aria-label="Admin navigation">
      <div className="sidebar-brand">
        <Printer size={20} strokeWidth={1.5} />
        <span>SelfPrint</span>
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
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
