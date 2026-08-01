"use client";

import {
  Check,
  Copy as CopyIcon,
  Crosshair,
  FileText,
  Hand,
  Loader2,
  MapPin,
  Navigation,
  Package,
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

// printed → packed → picked_up → out_for_delivery → delivered
const FLOW = [
  { key: "printed", label: "Printed", icon: Printer },
  { key: "packed", label: "Packed", icon: Package },
  { key: "picked_up", label: "Picked up", icon: Hand },
  { key: "out_for_delivery", label: "On the way", icon: Truck },
  { key: "delivered", label: "Delivered", icon: PackageCheck },
] as const;

// Index of the last completed step for a given delivery_status. Everything in
// the rider views is already printed, so that step is always done.
function doneIndex(status: DeliveryOrderView["deliveryStatus"]): number {
  if (status === "out_for_delivery") return 3;
  if (status === "picked_up") return 2;
  if (status === "packed") return 1;
  return 0;
}

function formatCapturedAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function OrderFlowSteps({ status }: { status: DeliveryOrderView["deliveryStatus"] }) {
  const done = doneIndex(status);

  return (
    <ol className="delivery-flow delivery-flow-5" aria-label="Order progress">
      {FLOW.map((step, i) => {
        const state = i <= done ? "done" : i === done + 1 ? "next" : "todo";
        const Icon = i <= done && i > 0 ? Check : step.icon;
        return (
          <li key={step.key} className={`delivery-flow-step ${state}`}>
            {i > 0 && <span className="delivery-flow-connector" aria-hidden="true" />}
            <span className="delivery-flow-dot"><Icon size={12} aria-hidden="true" /></span>
            <span className="delivery-flow-label">{step.label}</span>
          </li>
        );
      })}
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
        <span className="delivery-card-amount">{INR.format(order.amountPaise / 100)}</span>
      </header>

      <OrderFlowSteps status={order.deliveryStatus} />

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
          {order.copies === 1 ? "copy" : "copies"} · {order.paidAt ? "paid online" : "unpaid"}
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
        ) : order.deliveryStatus === "out_for_delivery" ? (
          <PackageCheck size={17} aria-hidden="true" />
        ) : order.deliveryStatus === "picked_up" ? (
          <Truck size={17} aria-hidden="true" />
        ) : (
          <Hand size={17} aria-hidden="true" />
        )}
        {busy ? "Working…" : actionLabel}
      </button>
    </article>
  );
}
