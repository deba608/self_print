"use client";

import { usePathname } from "next/navigation";
import UserNavbar from "@/components/UserNavbar";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith("/admin");
  // Rider dashboard ships its own topbar — the customer navbar (login/track
  // links) would be confusing for staff.
  const isDeliveryRoute = pathname.startsWith("/delivery");
  const isStaffInviteRoute = pathname.startsWith("/staff/");
  const isAuthRoute =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/complete-profile" ||
    pathname.startsWith("/reset-password");

  if (isAdminRoute || isDeliveryRoute || isStaffInviteRoute || isAuthRoute) {
    return children;
  }

  return (
    <>
      <UserNavbar />
      <div className="customer-app-content">{children}</div>
    </>
  );
}
