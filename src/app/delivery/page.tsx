import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/security";
import DeliveryDashboard from "@/components/pages/DeliveryDashboard";

export default async function DeliveryPage() {
  const staff = await requireStaff();
  // /admin renders the staff login form when there is no session.
  if (!staff) redirect("/admin");
  return <DeliveryDashboard staffName={staff.displayName ?? staff.email} />;
}
