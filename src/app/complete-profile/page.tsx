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
    .select("phone")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.phone) {
    redirect("/my-jobs");
  }

  return <CompleteProfileForm />;
}
