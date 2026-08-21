import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CompleteProfileForm from "@/components/pages/CompleteProfileForm";

export default async function CompleteProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("phone, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.phone && profile?.display_name) {
    redirect("/my-jobs");
  }

  return <CompleteProfileForm needsName={!profile?.display_name} />;
}
