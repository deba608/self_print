import { Suspense } from "react";
import ServiceAreaEditor from "@/components/admin/ServiceAreaEditor";

export default function Page() {
  return (
    <Suspense>
      <ServiceAreaEditor />
    </Suspense>
  );
}
