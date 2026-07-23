"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Printer, Upload, PackageSearch, Search, LogOut, UserRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/", label: "New Print", icon: Upload },
  { href: "/my-jobs", label: "My Jobs", icon: PackageSearch },
  { href: "/track", label: "Track", icon: Search },
] as const;

export default function UserNavbar() {
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data }) => {
        setEmail(data.user?.email ?? null);
      });
    } catch {
      setEmail(null);
    }
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {}
    window.location.href = "/login";
  };

  const activeTab = navItems.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
  )?.href;

  return (
    <>
      {/* Desktop / Tablet top navbar */}
      <header className="user-navbar">
        <Link href="/" className="user-navbar-logo">
          <Printer size={24} />
          <span>Self_Print</span>
        </Link>

        <nav className="user-navbar-nav" aria-label="Main">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`user-navbar-link ${activeTab === href ? "active" : ""}`}
              aria-current={activeTab === href ? "page" : undefined}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="user-navbar-user">
          {email === undefined ? (
            <span className="user-navbar-skeleton" aria-hidden="true" />
          ) : email ? (
            <>
              <span className="user-navbar-email">
                <UserRound size={14} aria-hidden="true" />
                <span>{email}</span>
              </span>
              <button
                type="button"
                className="user-navbar-logout"
                onClick={handleLogout}
                disabled={loggingOut}
                aria-label={loggingOut ? "Signing out" : "Log out"}
              >
                {loggingOut ? (
                  <Loader2 size={14} className="spin" aria-hidden="true" />
                ) : (
                  <LogOut size={14} aria-hidden="true" />
                )}
                <span>{loggingOut ? "Signing out..." : "Log out"}</span>
              </button>
            </>
          ) : (
            <Link href="/login" className="user-navbar-login-btn">Log in</Link>
          )}
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav className="user-bottom-nav" aria-label="Main">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`user-bottom-link ${activeTab === href ? "active" : ""}`}
            aria-current={activeTab === href ? "page" : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
