"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Loader2, Store, Truck, X } from "lucide-react";
import type { PricingConfig as Pricing } from "@/lib/types";
import { isAcceptingOrders, isDeliveryAvailable, weeklyScheduleLines } from "@/lib/pricing";

const WEEKDAYS: Array<{ iso: number; label: string }> = [
  { iso: 1, label: "Mon" }, { iso: 2, label: "Tue" }, { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" }, { iso: 5, label: "Fri" }, { iso: 6, label: "Sat" }, { iso: 7, label: "Sun" },
];

function DayPicker({ selected, onToggle }: { selected: number[]; onToggle: (iso: number) => void }) {
  return (
    <div className="hours-day-pills" role="group" aria-label="Days">
      {WEEKDAYS.map((day) => (
        <button
          key={day.iso}
          type="button"
          className={`hours-day-pill ${selected.includes(day.iso) ? "active" : ""}`}
          aria-pressed={selected.includes(day.iso)}
          onClick={() => onToggle(day.iso)}
        >
          {day.label}
        </button>
      ))}
    </div>
  );
}

function TimeRange({
  open, close, onOpen, onClose, idPrefix,
}: {
  open: string; close: string; onOpen: (v: string) => void; onClose: (v: string) => void; idPrefix: string;
}) {
  return (
    <div className="order-hours-range">
      <input id={`${idPrefix}-open`} type="time" value={open} onChange={(e) => onOpen(e.target.value)} />
      <span>to</span>
      <input id={`${idPrefix}-close`} type="time" value={close} onChange={(e) => onClose(e.target.value)} />
    </div>
  );
}

function StatusBadge({ status }: { status: { ok: true } | { ok: false; reason: string } }) {
  return (
    <span className={`hours-status-badge ${status.ok ? "is-open" : "is-closed"}`}>
      <span className="hours-status-dot" aria-hidden="true" />
      {status.ok ? "Open now" : "Closed now"}
    </span>
  );
}

export default function ServiceHoursPanel({
  pricing,
  onSave,
  onClose,
}: {
  pricing: Pricing;
  onSave: (data: {
    acceptingOrders: boolean;
    orderOpenTime: string | null; orderCloseTime: string | null;
    orderOpenTime2: string | null; orderCloseTime2: string | null; orderDays: string | null;
    deliveryOpenTime: string | null; deliveryCloseTime: string | null; deliveryDays: string | null;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [acceptingOrders, setAcceptingOrders] = useState(pricing.acceptingOrders);
  const [orderOpenTime, setOrderOpenTime] = useState(pricing.orderOpenTime ?? "");
  const [orderCloseTime, setOrderCloseTime] = useState(pricing.orderCloseTime ?? "");
  const [orderOpenTime2, setOrderOpenTime2] = useState(pricing.orderOpenTime2 ?? "");
  const [orderCloseTime2, setOrderCloseTime2] = useState(pricing.orderCloseTime2 ?? "");
  const [orderDays, setOrderDays] = useState((pricing.orderDays ?? "1,2,3,4,5,6,7").split(",").map(Number).filter(Boolean));
  const [deliveryOpenTime, setDeliveryOpenTime] = useState(pricing.deliveryOpenTime ?? "");
  const [deliveryCloseTime, setDeliveryCloseTime] = useState(pricing.deliveryCloseTime ?? "");
  const [deliveryDays, setDeliveryDays] = useState((pricing.deliveryDays ?? "1,2,3,4,5,6").split(",").map(Number).filter(Boolean));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // A day list of [] reads as "no restriction, every day" everywhere it's
  // consumed (isAcceptingOrders, weeklyScheduleLines) — so unchecking the
  // last remaining day would silently flip "closed all week" into "open
  // every day", the opposite of what the click looks like. Block it instead.
  const toggleDay = (list: number[], set: (v: number[]) => void, iso: number) => {
    if (list.includes(iso) && list.length === 1) {
      setError("At least one day must stay open.");
      return;
    }
    set(list.includes(iso) ? list.filter((d) => d !== iso) : [...list, iso].sort((a, b) => a - b));
    setSaved(false);
    setError("");
  };

  // Live preview built from the in-progress edits, not the saved pricing —
  // so toggling a day or window shows its effect before you hit Save.
  const draftPricing = useMemo<Pricing>(() => ({
    ...pricing,
    acceptingOrders,
    orderOpenTime: orderOpenTime || null,
    orderCloseTime: orderCloseTime || null,
    orderOpenTime2: orderOpenTime2 || null,
    orderCloseTime2: orderCloseTime2 || null,
    orderDays: orderDays.length ? orderDays.join(",") : null,
    deliveryOpenTime: deliveryOpenTime || null,
    deliveryCloseTime: deliveryCloseTime || null,
    deliveryDays: deliveryDays.length ? deliveryDays.join(",") : null,
  }), [pricing, acceptingOrders, orderOpenTime, orderCloseTime, orderOpenTime2, orderCloseTime2, orderDays, deliveryOpenTime, deliveryCloseTime, deliveryDays]);

  const pickupStatus = isAcceptingOrders(draftPricing);
  const deliveryStatus = isDeliveryAvailable(draftPricing) as { ok: true } | { ok: false; reason: string };
  const pickupSchedule = weeklyScheduleLines(draftPricing.orderDays, [
    [draftPricing.orderOpenTime, draftPricing.orderCloseTime],
    [draftPricing.orderOpenTime2, draftPricing.orderCloseTime2],
  ]);
  const deliverySchedule = weeklyScheduleLines(draftPricing.deliveryDays, [[draftPricing.deliveryOpenTime, draftPricing.deliveryCloseTime]]);

  const handleSave = async () => {
    if ((orderOpenTime && !orderCloseTime) || (!orderOpenTime && orderCloseTime)) {
      setError("Set both a pickup opening and closing time, or clear both.");
      return;
    }
    if ((orderOpenTime2 && !orderCloseTime2) || (!orderOpenTime2 && orderCloseTime2)) {
      setError("Set both a start and end time for the second pickup window, or clear both.");
      return;
    }
    if ((deliveryOpenTime && !deliveryCloseTime) || (!deliveryOpenTime && deliveryCloseTime)) {
      setError("Set both a delivery start and end time, or clear both.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        acceptingOrders,
        orderOpenTime: orderOpenTime || null,
        orderCloseTime: orderCloseTime || null,
        orderOpenTime2: orderOpenTime2 || null,
        orderCloseTime2: orderCloseTime2 || null,
        orderDays: orderDays.length ? orderDays.join(",") : null,
        deliveryOpenTime: deliveryOpenTime || null,
        deliveryCloseTime: deliveryCloseTime || null,
        deliveryDays: deliveryDays.length ? deliveryDays.join(",") : null,
      });
      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save hours.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="pricing-panel hours-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Clock size={20} className="panel-icon" />
            <h2>Service Hours</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="pricing-sections">
          <section className="pricing-section">
            <div className="pricing-field">
              <label htmlFor="acceptingOrders">Accepting new orders</label>
              <label className="pricing-toggle">
                <input
                  id="acceptingOrders"
                  type="checkbox"
                  checked={acceptingOrders}
                  onChange={(e) => { setAcceptingOrders(e.target.checked); setSaved(false); setError(""); }}
                />
                <span>{acceptingOrders ? "Open" : "Closed — customers can't upload"}</span>
              </label>
              <span className="pricing-hint">Manual kill switch, independent of the schedules below.</span>
            </div>
          </section>

          <section className="pricing-section hours-service-card">
            <h3><Store size={15} aria-hidden="true" /> Shop Pickup</h3>
            <StatusBadge status={pickupStatus} />
            <div className="pricing-grid single">
              <div className="pricing-field">
                <label>Open days</label>
                <DayPicker selected={orderDays} onToggle={(iso) => toggleDay(orderDays, setOrderDays, iso)} />
              </div>
              <div className="pricing-field">
                <label htmlFor="pickup1-open">Hours</label>
                <TimeRange idPrefix="pickup1" open={orderOpenTime} close={orderCloseTime} onOpen={setOrderOpenTime} onClose={setOrderCloseTime} />
              </div>
              <div className="pricing-field">
                <label htmlFor="pickup2-open">Second window (optional — e.g. after a lunch break)</label>
                <TimeRange idPrefix="pickup2" open={orderOpenTime2} close={orderCloseTime2} onOpen={setOrderOpenTime2} onClose={setOrderCloseTime2} />
              </div>
            </div>
            <ul className="hours-week-table">
              {pickupSchedule.map((row) => (
                <li key={row.iso} className={row.hours === "Closed" ? "is-closed" : ""}>
                  <span>{row.day}</span>
                  <span>{row.hours}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="pricing-section hours-service-card">
            <h3><Truck size={15} aria-hidden="true" /> Home Delivery</h3>
            <StatusBadge status={deliveryStatus} />
            <div className="pricing-grid single">
              <div className="pricing-field">
                <label>Delivery days</label>
                <DayPicker selected={deliveryDays} onToggle={(iso) => toggleDay(deliveryDays, setDeliveryDays, iso)} />
              </div>
              <div className="pricing-field">
                <label htmlFor="delivery-open">Hours</label>
                <TimeRange idPrefix="delivery" open={deliveryOpenTime} close={deliveryCloseTime} onOpen={setDeliveryOpenTime} onClose={setDeliveryCloseTime} />
                <span className="pricing-hint">Leave blank to allow delivery whenever the shop is open.</span>
              </div>
            </div>
            <ul className="hours-week-table">
              {deliverySchedule.map((row) => (
                <li key={row.iso} className={row.hours === "Closed" ? "is-closed" : ""}>
                  <span>{row.day}</span>
                  <span>{row.hours}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {error && <p className="panel-error" role="alert">{error}</p>}

        <div className="panel-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saved || saving}>
            {saving ? (
              <><Loader2 size={18} className="spin" />Saving...</>
            ) : saved ? (
              <><Check size={18} />Saved!</>
            ) : (
              <>Save Changes</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
