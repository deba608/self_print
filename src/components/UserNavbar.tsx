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
  // undefined = auth state not resolved yet; null = signed out; "" = signed
  // in with no usable name; string = signed in with a first name.
  const [displayName, setDisplayName] = useState<string | null | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    /** Return only the first name from the registration display_name */
    const resolveName = (user: import("@supabase/supabase-js").User) => {
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const fullName =
        (typeof meta?.display_name === "string" && meta.display_name) ||
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        "";
      // Accounts created before the register route stopped falling back to
      // email still carry the email in display_name — treat that as no name.
      if (fullName.includes("@")) return "";
      // Take only the first word (first name) — trim whitespace first
      return fullName.trim().split(/\s+/)[0] || "";
    };

    // Subscribe to auth changes — fires immediately with the current session,
    // so the navbar updates the moment the user logs in or out. A signed-in
    // user with no usable name is still signed in ("") — never fall through
    // to the logged-out null branch, which would show Log in/Sign up.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setDisplayName(session?.user ? resolveName(session.user) : null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
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
            ) : displayName !== null ? (
              <>
                {displayName && (
                  <span className="user-navbar-email" title={displayName}>
                    <UserRound size={14} aria-hidden="true" />
                    <span>{displayName}</span>
                  </span>
                )}
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
