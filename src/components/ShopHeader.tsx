"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Printer, Upload, Search } from "lucide-react";

export default function ShopHeader() {
  const pathname = usePathname();
  const onTrack = pathname?.startsWith("/track");

  return (
    <header className="shop-header">
      <Link href="/" className="shop-logo">
        <Printer size={26} />
        <span>Self_Print</span>
      </Link>

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
