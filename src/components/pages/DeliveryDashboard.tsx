"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Inbox,
  LogOut,
  PackageCheck,
  Printer,
  RefreshCw,
  Truck,
} from "lucide-react";
import type { DeliveryOrderView } from "@/lib/delivery";
import DeliveryOrderCard from "@/components/delivery/DeliveryOrderCard";

type Props = { staffName: string };

export default function DeliveryDashboard({ staffName }: Props) {
  const [available, setAvailable] = useState<DeliveryOrderView[]>([]);
  const [mine, setMine] = useState<DeliveryOrderView[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Reuse the staff SSE stream so claims by other riders refresh the pool
    // live; keep 15s polling as a fallback if the stream drops.
    let es: EventSource;
    let backoff = 1000;
    let retryId: ReturnType<typeof setTimeout>;
    let debounceId: ReturnType<typeof setTimeout>;

    // A burst of broadcasts (claim + advance) would fire overlapping refetches
    // whose responses can land out of order — coalesce them.
    function scheduleLoad() {
      clearTimeout(debounceId);
      debounceId = setTimeout(load, 300);
    }

    function connect() {
      es = new EventSource("/api/admin/notifications");
      es.onopen = () => { backoff = 1000; };
      es.onmessage = scheduleLoad;
      es.onerror = () => {
        const delay = backoff;
        backoff = Math.min(delay * 2, 30000);
        clearTimeout(retryId);
        retryId = setTimeout(connect, delay);
      };
    }

    connect();
    // Skip polling while the tab is hidden (riders' phones in a pocket);
    // refetch immediately when it becomes visible again.
    const poll = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(retryId);
      clearTimeout(debounceId);
      es.close();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function act(id: string, action: "claim" | "out_for_delivery" | "delivered") {
    if (busyId) return; // one action in flight at a time — no double-taps
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        action === "claim" ? `/api/delivery/jobs/${id}/claim` : `/api/delivery/jobs/${id}/advance`,
        {
          method: "POST",
          credentials: "include",
          ...(action !== "claim" && {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ next: action }),
          }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Action failed");
      // Optimistic move so the card reflects the action instantly instead of
      // waiting for the refetch below (which still reconciles the real state).
      if (action === "claim") {
        const claimed = available.find((o) => o.id === id);
        setAvailable((prev) => prev.filter((o) => o.id !== id));
        if (claimed) setMine((m) => [{ ...claimed, deliveryStatus: "picked_up" }, ...m]);
      } else if (action === "out_for_delivery") {
        setMine((prev) => prev.map((o) => o.id === id ? { ...o, deliveryStatus: "out_for_delivery" } : o));
      } else {
        setMine((prev) => prev.filter((o) => o.id !== id));
      }
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed");
      load();
    } finally {
      setBusyId(null);
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
    <div className="delivery-shell">
      <header className="delivery-topbar">
        <span className="delivery-brand">
          <Printer size={18} aria-hidden="true" />
          SelfPrint <em>Delivery</em>
        </span>
        <div className="delivery-topbar-actions">
          <button
            type="button"
            className="delivery-icon-btn"
            onClick={() => { setRefreshing(true); load(); }}
            disabled={refreshing}
            aria-label="Refresh orders"
          >
            <RefreshCw size={17} className={refreshing ? "spin" : ""} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="delivery-icon-btn"
            onClick={logout}
            disabled={loggingOut}
            aria-label="Log out"
          >
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="delivery-page">
        <p className="delivery-greeting">
          Hi <strong>{staffName}</strong> — {mine.length === 0
            ? "no active deliveries."
            : `${mine.length} order${mine.length === 1 ? "" : "s"} on the road.`}
        </p>

        {error && (
          <p className="delivery-error" role="alert">
            <AlertCircle size={15} aria-hidden="true" />
            {error}
          </p>
        )}

        <section className="delivery-section" aria-labelledby="mine-title">
          <h2 id="mine-title">
            <Truck size={16} aria-hidden="true" />
            My deliveries
            <span className="delivery-count">{mine.length}</span>
          </h2>
          {loading ? (
            <div className="delivery-grid" aria-busy="true" aria-label="Loading your deliveries">
              <div className="delivery-card-skeleton" />
            </div>
          ) : mine.length === 0 ? (
            <div className="delivery-empty">
              <PackageCheck size={22} aria-hidden="true" />
              Nothing on the road. Claim an order below.
            </div>
          ) : (
            <div className="delivery-grid">
              {mine.map((order) => (
                <DeliveryOrderCard
                  key={order.id}
                  order={order}
                  claimed
                  actionLabel={order.deliveryStatus === "picked_up" ? "Start delivery" : "Mark delivered"}
                  busy={busyId === order.id}
                  onAction={() =>
                    act(order.id, order.deliveryStatus === "picked_up" ? "out_for_delivery" : "delivered")
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="delivery-section" aria-labelledby="pool-title">
          <h2 id="pool-title">
            <Inbox size={16} aria-hidden="true" />
            Available
            <span className="delivery-count">{available.length}</span>
          </h2>
          {loading ? (
            <div className="delivery-grid" aria-busy="true" aria-label="Loading available orders">
              <div className="delivery-card-skeleton" />
              <div className="delivery-card-skeleton" />
            </div>
          ) : available.length === 0 ? (
            <div className="delivery-empty">
              <Inbox size={22} aria-hidden="true" />
              No orders waiting — new paid orders appear here automatically.
            </div>
          ) : (
            <div className="delivery-grid">
              {available.map((order) => (
                <DeliveryOrderCard
                  key={order.id}
                  order={order}
                  actionLabel="Claim & pick up"
                  busy={busyId === order.id}
                  onAction={() => act(order.id, "claim")}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
