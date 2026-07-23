"use client";

import { usePathname } from "next/navigation";
import UserNavbar from "@/components/UserNavbar";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith("/admin");
  const isStaffInviteRoute = pathname.startsWith("/staff/");
  const isAuthRoute =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/reset-password");

  if (isAdminRoute || isStaffInviteRoute || isAuthRoute) {
    return children;
  }

  return (
    <>
      <UserNavbar />
      <div className="customer-app-content">{children}</div>
    </>
  );
}
