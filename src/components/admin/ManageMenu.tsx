"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BarChart2, ChevronDown, LayoutGrid, ListTodo, ShieldCheck, Users, UsersRound } from "lucide-react";

// Groups the 4 "navigate away to a full management page" links that used
// to sit as bare icons alongside stay-in-place utility buttons (refresh,
// notifications) with no visual distinction — clicking one kept you on the
// dashboard, clicking another silently left it. One labeled entry point
// makes that boundary obvious instead of hiding it behind identical icons.
export default function ManageMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { href: "/admin/orders", icon: ListTodo, label: "Order Management", hint: "Full order list, search & filters" },
    { href: "/admin/customers", icon: UsersRound, label: "User Management", hint: "Customer accounts" },
    { href: "/admin/accounts", icon: BarChart2, label: "Accounts & Daily Data", hint: "Revenue, daily close-out" },
    { href: "/admin/staff", icon: Users, label: "Staff Management", hint: "Invite & manage staff logins" },
    { href: "/admin/security", icon: ShieldCheck, label: "Security", hint: "Login audit log" },
  ];

  return (
    <div className="manage-menu" ref={ref}>
      <button
        type="button"
        className={`action-btn action-btn-labeled ${open ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <LayoutGrid size={17} />
        <span>Manage</span>
        <ChevronDown size={14} className="chevron" />
      </button>
      {open && (
        <div className="manage-menu-panel" role="menu">
          <span className="manage-menu-caption">Go to a management page</span>
          {items.map(({ href, icon: Icon, label, hint }) => (
            <Link key={href} href={href} className="manage-menu-item" role="menuitem" onClick={() => setOpen(false)}>
              <Icon size={17} aria-hidden="true" />
              <span className="manage-menu-item-text">
                <strong>{label}</strong>
                <span>{hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
