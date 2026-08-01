import { redirect } from "next/navigation";
import DeliveryDashboard from "@/components/pages/DeliveryDashboard";
import DeliveryLogin from "@/components/pages/DeliveryLogin";
import { createClient } from "@/lib/supabase/server";

// /delivery is both the rider login page and the dashboard: with no staff
// session it renders the sign-in form; once the session cookie is set it
// renders the dashboard in place. Admin/super_admin staff get bounced to
// /admin — this surface is for delivery riders only.
export default async function DeliveryPage() {
  let isOtherStaffRole = false;
  let deliveryProfile: { display_name: string | null; email: string } | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("staff_profiles")
        .select("id, role, display_name, email")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.role === "delivery") {
        deliveryProfile = profile;
      } else if (profile) {
        isOtherStaffRole = true;
      }
    }
  } catch {
    // Supabase env not configured — fall through to the login form.
  }
  // redirect() throws NEXT_REDIRECT, so it must live outside the try/catch.
  if (isOtherStaffRole) redirect("/admin");
  if (deliveryProfile) {
    return <DeliveryDashboard staffName={deliveryProfile.display_name ?? deliveryProfile.email} />;
  }
  return <DeliveryLogin />;
}
