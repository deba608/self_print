import type { Metadata } from "next";

// Shop staff install this from /admin — its own manifest points start_url
// at /admin so the home-screen icon opens straight to the dashboard, not
// the customer upload page.
export const metadata: Metadata = {
  title: "Self_Print Admin",
  manifest: "/manifest-admin.json"
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
