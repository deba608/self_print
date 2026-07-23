"use client";

import { useFormStatus } from "react-dom";
import { Loader2, LogOut } from "lucide-react";

export default function CustomerLogoutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="jobs-logout-btn"
      disabled={pending}
      aria-label={pending ? "Signing out" : "Log out"}
    >
      {pending ? (
        <Loader2 size={15} className="spin" aria-hidden="true" />
      ) : (
        <LogOut size={15} aria-hidden="true" />
      )}
      <span>{pending ? "Signing out..." : "Log out"}</span>
    </button>
  );
}
