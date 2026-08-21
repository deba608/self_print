"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, User } from "lucide-react";
import { AuthShell, AuthInput, AuthError, AuthSubmit } from "@/components/ui/Auth";

export default function CompleteProfileForm({ needsName = false }: { needsName?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (needsName && !name.trim()) {
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
        body: JSON.stringify({ phone, name: needsName ? name.trim() : undefined }),
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
        {needsName && (
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
        )}
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
