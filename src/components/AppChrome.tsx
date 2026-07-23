"use client";

import { usePathname } from "next/navigation";
import UserNavbar from "@/components/UserNavbar";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith("/admin");
  const isStaffInviteRoute = pathname.startsWith("/staff/");

  if (isAdminRoute || isStaffInviteRoute) {
    return children;
  }

  return (
    <>
      <UserNavbar />
      <div className="customer-app-content">{children}</div>
    </>
  );
}
