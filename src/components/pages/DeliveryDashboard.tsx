"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeliveryOrderView } from "@/lib/delivery";
import DeliveryOrderCard from "@/components/delivery/DeliveryOrderCard";

type Props = { staffName: string };

export default function DeliveryDashboard({ staffName }: Props) {
  const [available, setAvailable] = useState<DeliveryOrderView[]>([]);
  const [mine, setMine] = useState<DeliveryOrderView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/delivery/jobs", { cache: "no-store", credentials: "include" });
      if (!res.ok) throw new Error("Failed to load orders");
      const body = await res.json();
      setAvailable(body.available ?? []);
      setMine(body.mine ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Reuse the staff SSE stream so claims by other riders refresh the pool
    // live; keep 15s polling as a fallback if the stream drops.
    const es = new EventSource("/api/admin/notifications");
    es.onmessage = () => load();
    const poll = setInterval(load, 15000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [load]);

  async function act(id: string, path: "claim" | "delivered") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/delivery/jobs/${id}/${path}`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Action failed");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
    } finally {
      window.location.href = "/admin";
    }
  }

  return (
    <main className="delivery-page">
      <header className="delivery-header">
        <h1>Deliveries</h1>
        <div className="delivery-header-right">
          <span className="delivery-staff-name">{staffName}</span>
          <button type="button" className="delivery-logout" onClick={logout} disabled={loggingOut}>
            {loggingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
      </header>

      {error && <p className="delivery-error" role="alert">{error}</p>}
      {loading && <p className="delivery-loading">Loading orders…</p>}

      <section className="delivery-section">
        <h2>My deliveries ({mine.length})</h2>
        {mine.length === 0 && !loading && <p className="delivery-empty">No active deliveries.</p>}
        <div className="delivery-grid">
          {mine.map((order) => (
            <DeliveryOrderCard
              key={order.id}
              order={order}
              actionLabel="Mark delivered"
              busy={busyId === order.id}
              onAction={() => act(order.id, "delivered")}
            />
          ))}
        </div>
      </section>

      <section className="delivery-section">
        <h2>Available ({available.length})</h2>
        {available.length === 0 && !loading && <p className="delivery-empty">No orders waiting.</p>}
        <div className="delivery-grid">
          {available.map((order) => (
            <DeliveryOrderCard
              key={order.id}
              order={order}
              actionLabel="Claim"
              busy={busyId === order.id}
              onAction={() => act(order.id, "claim")}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
