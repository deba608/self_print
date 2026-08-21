"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, User } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthSubmit } from "@/components/ui/Auth";

export default function CompleteProfileForm({ defaultName = "" }: { defaultName?: string }) {
  const router = useRouter();
  // Always editable, even when Google supplied a name — a Google account can
  // carry any name regardless of the email it's signed up with, so it's
  // pre-filled as a starting point, not trusted as final.
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!phone.trim()) {
      setError("Phone number is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/user/complete-profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name.trim() }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error || "Unable to save phone number");
        setLoading(false);
        return;
      }
      router.push("/my-jobs");
    } catch {
      setError("Connection error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <AuthShell title="One Last Step" subtitle="Enter your WhatsApp number to receive order updates and delivery tracking">
      <form className="login-form" onSubmit={handleSubmit}>
        <AuthInput
          id="name"
          label="Your Name"
          icon={User}
          value={name}
          onChange={setName}
          placeholder="Full name"
          autoComplete="name"
          disabled={loading}
          required
        />
        <AuthInput
          id="phone"
          label="WhatsApp Number"
          icon={Phone}
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={setPhone}
          placeholder="10-digit mobile number"
          autoComplete="tel"
          disabled={loading}
          required
        />
        <AuthError>{error}</AuthError>
        <AuthSubmit loading={loading} loadingLabel="Saving…" label="Continue" />
      </form>
    </AuthShell>
  );
}
