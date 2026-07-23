import AdminDashboard from "@/components/AdminDashboard";
import AdminLogin from "@/components/AdminLogin";
import { createClient } from "@/lib/supabase/server";

// /admin is both the staff login page and the dashboard: with no staff
// session it renders the sign-in form; once the session cookie is set it
// renders the dashboard in place.
export default async function AdminPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("staff_profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (profile) return <AdminDashboard />;
    }
  } catch {
    // Supabase env not configured — fall through to the login form.
  }
  return <AdminLogin />;
}
