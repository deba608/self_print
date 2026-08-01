import { Suspense } from "react";
import OrderManagementPage from "@/components/pages/OrderManagementPage";

export default function Page() {
  return (
    <Suspense>
      <OrderManagementPage />
    </Suspense>
  );
}
