import { redirect } from "next/navigation";
import AdminDashboard from "@/components/pages/AdminDashboard";
import AdminLogin from "@/components/pages/AdminLogin";
import { createClient } from "@/lib/supabase/server";

// /admin is both the staff login page and the dashboard: with no staff
// session it renders the sign-in form; once the session cookie is set it
// renders the dashboard in place. Delivery riders get their own surface.
export default async function AdminPage() {
  let isDeliveryRole = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("staff_profiles")
        .select("id, role")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role === "delivery") {
        isDeliveryRole = true;
      } else if (profile) {
        return <AdminDashboard />;
      }
    }
  } catch {
    // Supabase env not configured — fall through to the login form.
  }
  // redirect() throws NEXT_REDIRECT, so it must live outside the try/catch.
  if (isDeliveryRole) redirect("/delivery");
  return <AdminLogin />;
}
