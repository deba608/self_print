"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Printer, Upload, Search, UserRound, PackageSearch } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ShopHeader() {
  const pathname = usePathname();
  const onTrack = pathname?.startsWith("/track");
  // null = signed out, string = signed-in email, undefined = still checking
  const [email, setEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data }) => {
        setEmail(data.user?.email ?? null);
      });
    } catch {
      // Supabase env not configured (pure-SQLite local dev) — act as guest.
      setEmail(null);
    }
  }, []);

  return (
    <header className="shop-header">
      <Link href="/" className="shop-logo">
        <Printer size={26} />
        <span>Self_Print</span>
      </Link>

      <div className="shop-auth">
        {email === undefined ? null : email ? (
          <Link href="/my-jobs" className="shop-auth-btn">
            <PackageSearch size={15} aria-hidden="true" />
            My Jobs
          </Link>
        ) : (
          <>
            <Link href="/login" className="shop-auth-link">
              Log in
            </Link>
            <Link href="/register" className="shop-auth-btn">
              <UserRound size={15} aria-hidden="true" />
              Sign up
            </Link>
          </>
        )}
      </div>

      <nav className="shop-nav" aria-label="Primary">
        <Link href="/" className={`shop-nav-tab ${!onTrack ? "active" : ""}`}>
          <Upload size={14} aria-hidden="true" />
          New Print
        </Link>
        <Link href="/track" className={`shop-nav-tab ${onTrack ? "active" : ""}`}>
          <Search size={14} aria-hidden="true" />
          Track Order
        </Link>
      </nav>
    </header>
  );
}
