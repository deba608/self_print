"use client";

// TEMPORARY scratch route for visually verifying PricingPanel without an admin
// session. Delete before committing.
import PricingPanel from "@/components/admin/PricingPanel";

export default function Page() {
  return (
    <PricingPanel
      pricing={null}
      onSave={async () => {}}
      onClose={() => {}}
    />
  );
}
