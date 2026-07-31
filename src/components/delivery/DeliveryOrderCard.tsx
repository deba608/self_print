"use client";

import type { DeliveryOrderView } from "@/lib/delivery";

type Props = {
  order: DeliveryOrderView;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
};

export default function DeliveryOrderCard({ order, actionLabel, onAction, busy }: Props) {
  const mapUrl =
    order.deliveryLatitude != null && order.deliveryLongitude != null
      ? `https://www.google.com/maps?q=${order.deliveryLatitude},${order.deliveryLongitude}`
      : null;

  return (
    <article className="delivery-card">
      <header className="delivery-card-head">
        <span className="delivery-card-token">{order.token}</span>
        <span className="delivery-card-amount">₹{(order.amountPaise / 100).toFixed(2)}</span>
      </header>
      <div className="delivery-card-body">
        <p className="delivery-card-name">{order.customerName ?? "Customer"}</p>
        {order.customerPhone && (
          <a className="delivery-card-phone" href={`tel:${order.customerPhone}`}>
            {order.customerPhone}
          </a>
        )}
        {order.deliveryAddress && <p className="delivery-card-address">{order.deliveryAddress}</p>}
        <p className="delivery-card-meta">
          {order.pageCount} page{order.pageCount === 1 ? "" : "s"} × {order.copies}{" "}
          {order.copies === 1 ? "copy" : "copies"}
        </p>
        {mapUrl && (
          <a className="delivery-card-map" href={mapUrl} target="_blank" rel="noreferrer">
            Open in Maps
          </a>
        )}
      </div>
      <button type="button" className="delivery-card-action" onClick={onAction} disabled={busy}>
        {busy ? "Working…" : actionLabel}
      </button>
    </article>
  );
}
