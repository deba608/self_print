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
  const [displayName, setDisplayName] = useState<string | null | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data }) => {
        const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
        const metaName = typeof meta?.display_name === "string" ? meta.display_name : null;
        setDisplayName(metaName ?? data.user?.email ?? null);
      });
    } catch {
      setDisplayName(null);
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
  const showBottomNav = activeTab !== undefined;

  return (
    <>
      <header className="user-navbar">
        <div className="user-navbar-inner">
          <Link href="/" className="user-navbar-logo" aria-label="Self Print home">
            <Printer size={24} aria-hidden="true" />
            <span>Self_Print</span>
          </Link>

          <nav className="user-navbar-nav" aria-label="Customer navigation">
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
            {displayName === undefined ? (
              <span className="user-navbar-skeleton" aria-hidden="true" />
            ) : displayName ? (
              <>
                <span className="user-navbar-email" title={displayName}>
                  <UserRound size={14} aria-hidden="true" />
                  <span>{displayName}</span>
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
              <>
                <Link
                  href="/login"
                  className={`user-navbar-login-link ${pathname === "/login" ? "active" : ""}`}
                  aria-current={pathname === "/login" ? "page" : undefined}
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className={`user-navbar-signup-btn ${pathname === "/register" ? "active" : ""}`}
                  aria-current={pathname === "/register" ? "page" : undefined}
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {showBottomNav && (
        <nav className="user-bottom-nav" aria-label="Customer navigation">
          <div className="user-bottom-nav-inner">
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
          </div>
        </nav>
      )}
    </>
  );
}
