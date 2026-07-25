"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Printer, Upload, PackageSearch, Search, LogOut, UserRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const navItems = [
  { href: "/", label: "New Print", icon: Upload },
  { href: "/track", label: "Track", icon: Search },
  { href: "/my-jobs", label: "My Jobs", icon: PackageSearch },
] as const;

type Identity = { name: string; avatarUrl: string | null };

export default function UserNavbar() {
  const pathname = usePathname();
  // undefined = auth state not resolved yet; null = signed out; Identity =
  // signed in (name may be "" if there's no usable name on file).
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let mounted = true;
    const supabase = createClient();

    /** Return only the first name (+ avatar) from the registration profile */
    const resolveIdentity = (user: import("@supabase/supabase-js").User): Identity => {
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const fullName =
        (typeof meta?.display_name === "string" && meta.display_name) ||
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        "";
      // Accounts created before the register route stopped falling back to
      // email still carry the email in display_name — treat that as no name.
      const name = fullName.includes("@") ? "" : fullName.trim().split(/\s+/)[0] || "";
      const avatarUrl = typeof meta?.avatar_url === "string" && meta.avatar_url ? meta.avatar_url : null;
      return { name, avatarUrl };
    };

    // Subscribe to auth changes — fires immediately with the current session,
    // so the navbar updates the moment the user logs in or out. A signed-in
    // user with no usable name is still signed in (name: "") — never fall
    // through to the logged-out null branch, which would show Log in/Sign up.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setIdentity(session?.user ? resolveIdentity(session.user) : null);
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
            {identity === undefined ? (
              <span className="user-navbar-skeleton" aria-hidden="true" />
            ) : identity !== null ? (
              <>
                <Link
                  href="/account"
                  className="user-navbar-email"
                  title={identity.name || "My account"}
                  aria-current={pathname === "/account" ? "page" : undefined}
                >
                  {identity.avatarUrl ? (
                    <img src={identity.avatarUrl} alt="" className="user-navbar-avatar" />
                  ) : (
                    <UserRound size={14} aria-hidden="true" />
                  )}
                  {identity.name && <span>{identity.name}</span>}
                </Link>
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
