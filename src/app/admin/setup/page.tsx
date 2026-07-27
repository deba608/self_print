"use client";

import { useState } from "react";

export default function SetupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create admin");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>&#10003;</div>
          <h2>Admin Created</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
            You can now log in with your credentials.
          </p>
          <a href="/admin" className="auth-submit" style={{ display: "inline-block" }}>
            Go to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h2>Initial Setup</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: 24 }}>
          Create the first super admin account to get started.
        </p>
        <form onSubmit={handleSubmit}>
          <label className="auth-field">
            <span className="auth-label">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@shop.com"
            />
          </label>
          <label className="auth-field">
            <span className="auth-label">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
              minLength={6}
            />
          </label>
          <label className="auth-field">
            <span className="auth-label">Display Name (optional)</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Owner"
            />
          </label>
          {error && <p style={{ color: "var(--color-error)", marginBottom: 16 }}>{error}</p>}
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "Creating..." : "Create Admin"}
          </button>
        </form>
      </div>
    </div>
  );
}
