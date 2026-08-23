"use client";

import { useState } from "react";
import { ChevronDown, Clock, Store, Truck } from "lucide-react";
import { isAcceptingOrders, isDeliveryAvailable, weeklyScheduleLines } from "@/lib/pricing";
import type { Pricing } from "./shared";

// Customer-facing hours summary: a one-line "open/closed now" status that
// expands into the full Mon-Sun pickup + delivery schedule. Reads the same
// pricing config and weeklyScheduleLines() the admin panel uses, so the two
// can never show different hours.
export default function ShopHoursCard({ pricing }: { pricing: Pricing }) {
  const [open, setOpen] = useState(false);

  const pickupStatus = isAcceptingOrders(pricing);
  const deliveryStatus = isDeliveryAvailable(pricing);
  const pickupSchedule = weeklyScheduleLines(pricing.orderDays, [
    [pricing.orderOpenTime, pricing.orderCloseTime],
    [pricing.orderOpenTime2, pricing.orderCloseTime2],
  ]);
  const deliverySchedule = weeklyScheduleLines(pricing.deliveryDays, [[pricing.deliveryOpenTime, pricing.deliveryCloseTime]]);
  const showDeliveryRow = Boolean(pricing.deliveryOpenTime && pricing.deliveryCloseTime);

  return (
    <div className={`shop-hours-card ${open ? "is-open" : ""}`}>
      <button type="button" className="shop-hours-summary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Clock size={16} aria-hidden="true" className="shop-hours-icon" />
        <span className={`shop-hours-pill ${pickupStatus.ok ? "is-open" : "is-closed"}`}>
          {pickupStatus.ok ? "Shop open now" : "Shop closed now"}
        </span>
        <span className="shop-hours-summary-text">
          {pricing.orderOpenTime && pricing.orderCloseTime ? "See hours" : "Open anytime"}
        </span>
        <ChevronDown size={16} className="shop-hours-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="shop-hours-detail">
          <div className="shop-hours-service">
            <div className="shop-hours-service-title"><Store size={14} aria-hidden="true" /> Shop Pickup</div>
            <ul className="shop-hours-table">
              {pickupSchedule.map((row) => (
                <li key={row.iso} className={row.hours === "Closed" ? "is-closed" : ""}>
                  <span>{row.day}</span>
                  <span>{row.hours}</span>
                </li>
              ))}
            </ul>
          </div>

          {showDeliveryRow && (
            <div className="shop-hours-service">
              <div className="shop-hours-service-title"><Truck size={14} aria-hidden="true" /> Home Delivery</div>
              <ul className="shop-hours-table">
                {deliverySchedule.map((row) => (
                  <li key={row.iso} className={row.hours === "Closed" ? "is-closed" : ""}>
                    <span>{row.day}</span>
                    <span>{row.hours}</span>
                  </li>
                ))}
              </ul>
              {!deliveryStatus.ok && <p className="shop-hours-note">{deliveryStatus.reason}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
