"use client";

import {
  Check,
  Copy as CopyIcon,
  Crosshair,
  FileText,
  Loader2,
  MapPin,
  Navigation,
  PackageCheck,
  Phone,
  Printer,
  Truck,
} from "lucide-react";
import type { DeliveryOrderView } from "@/lib/delivery";

type Props = {
  order: DeliveryOrderView;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
  claimed?: boolean;
};

function formatCapturedAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Rider-relevant slice of the order lifecycle. Everything in the pool is
// already printed + paid, so the stepper starts at Printed.
function OrderFlowSteps({ claimed }: { claimed: boolean }) {
  const steps = [
    { label: "Printed", icon: <Printer size={13} aria-hidden="true" />, state: "done" },
    {
      label: "Out for delivery",
      icon: claimed ? <Check size={13} aria-hidden="true" /> : <Truck size={13} aria-hidden="true" />,
      state: claimed ? "done" : "next",
    },
    { label: "Delivered", icon: <PackageCheck size={13} aria-hidden="true" />, state: claimed ? "next" : "todo" },
  ] as const;

  return (
    <ol className="delivery-flow" aria-label="Order progress">
      {steps.map((step) => (
        <li key={step.label} className={`delivery-flow-step ${step.state}`}>
          <span className="delivery-flow-dot">{step.icon}</span>
          <span className="delivery-flow-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export default function DeliveryOrderCard({ order, actionLabel, onAction, busy, claimed = false }: Props) {
  const hasPin = order.deliveryLatitude != null && order.deliveryLongitude != null;
  // GPS pin captured on the customer's phone at upload time — far more precise
  // than geocoding the written address. Prefer it for navigation.
  const directionsUrl = hasPin
    ? `https://www.google.com/maps/dir/?api=1&destination=${order.deliveryLatitude},${order.deliveryLongitude}`
    : order.deliveryAddress
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(order.deliveryAddress)}`
      : null;
  const pinUrl = hasPin
    ? `https://www.google.com/maps/search/?api=1&query=${order.deliveryLatitude},${order.deliveryLongitude}`
    : null;

  return (
    <article className={`delivery-card${claimed ? " is-claimed" : ""}`}>
      <header className="delivery-card-head">
        <span className="delivery-card-token">
          <FileText size={14} aria-hidden="true" />
          {order.token}
        </span>
        <span className="delivery-card-amount">₹{(order.amountPaise / 100).toFixed(2)}</span>
      </header>

      <OrderFlowSteps claimed={claimed} />

      <div className="delivery-card-body">
        <p className="delivery-card-name">{order.customerName ?? "Customer"}</p>
        {order.deliveryAddress && (
          <p className="delivery-card-address">
            <MapPin size={14} aria-hidden="true" />
            <span>{order.deliveryAddress}</span>
          </p>
        )}
        {hasPin && (
          <p className="delivery-card-gps">
            <Crosshair size={13} aria-hidden="true" />
            <span>
              Exact GPS pin
              {order.deliveryAccuracyMeters != null && ` · ±${Math.round(order.deliveryAccuracyMeters)} m`}
              {order.deliveryLocationCapturedAt && ` · shared ${formatCapturedAt(order.deliveryLocationCapturedAt)}`}
            </span>
          </p>
        )}
        <p className="delivery-card-meta">
          <CopyIcon size={13} aria-hidden="true" />
          {order.pageCount} page{order.pageCount === 1 ? "" : "s"} × {order.copies}{" "}
          {order.copies === 1 ? "copy" : "copies"} · paid online
        </p>
      </div>

      <div className="delivery-card-links">
        {order.customerPhone && (
          <a
            className="delivery-chip-btn"
            href={`tel:${order.customerPhone}`}
            aria-label={`Call ${order.customerName ?? "customer"} at ${order.customerPhone}`}
          >
            <Phone size={15} aria-hidden="true" />
            Call
          </a>
        )}
        {directionsUrl && (
          <a
            className="delivery-chip-btn primary-chip"
            href={directionsUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={hasPin ? "Navigate to the customer's GPS pin" : "Navigate to the delivery address"}
          >
            <Navigation size={15} aria-hidden="true" />
            Navigate
          </a>
        )}
        {pinUrl && (
          <a
            className="delivery-chip-btn"
            href={pinUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="View the customer's exact pin on the map"
          >
            <MapPin size={15} aria-hidden="true" />
            View pin
          </a>
        )}
      </div>

      <button type="button" className="delivery-card-action" onClick={onAction} disabled={busy}>
        {busy ? (
          <Loader2 size={17} className="spin" aria-hidden="true" />
        ) : claimed ? (
          <PackageCheck size={17} aria-hidden="true" />
        ) : (
          <Truck size={17} aria-hidden="true" />
        )}
        {busy ? "Working…" : actionLabel}
      </button>
    </article>
  );
}
