import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AccountEditor from "@/components/pages/AccountEditor";

export default async function AccountPage() {
  let user = null;
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    user = authUser;
  } catch {
    user = null;
    supabase = null;
  }

  if (!user || !supabase) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("display_name, avatar_url, phone")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="customer-shell">
      <AccountEditor
        userId={user.id}
        email={user.email ?? ""}
        initialDisplayName={profile?.display_name ?? ""}
        initialAvatarUrl={profile?.avatar_url ?? null}
        initialPhone={profile?.phone ?? ""}
      />
    </main>
  );
}
