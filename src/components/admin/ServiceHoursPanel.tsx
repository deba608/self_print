"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Loader2, Pause, Play, Store, Timer, Truck, X } from "lucide-react";
import type { PricingConfig as Pricing } from "@/lib/types";
import { activePause, isAcceptingOrders, isDeliveryAvailable, pauseReason, weeklyScheduleLines } from "@/lib/pricing";

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

const PAUSE_PRESETS_MINUTES = [15, 30, 60, 120];

function countdownLabel(until: Date, now: number): string {
  const ms = until.getTime() - now;
  if (ms <= 0) return "resuming…";
  const mins = Math.ceil(ms / 60000);
  if (mins < 60) return `${mins} min left`;
  const hrs = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hrs} hr ${rest} min left` : `${hrs} hr left`;
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
  onPauseAction,
  onClose,
}: {
  pricing: Pricing;
  onSave: (data: {
    acceptingOrders: boolean;
    orderOpenTime: string | null; orderCloseTime: string | null;
    orderOpenTime2: string | null; orderCloseTime2: string | null; orderDays: string | null;
    deliveryOpenTime: string | null; deliveryCloseTime: string | null; deliveryDays: string | null;
  }) => Promise<void>;
  onPauseAction: (data: {
    pauseMinutes?: number; pausedUntil?: string | null; pauseNote?: string | null;
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

  // Temporary timed pause — applied immediately via onPauseAction, separate
  // from the Save Changes flow for the schedules below.
  const [pausePreset, setPausePreset] = useState<number | "custom" | null>(null);
  const [pauseCustomTime, setPauseCustomTime] = useState("");
  const [pauseNoteDraft, setPauseNoteDraft] = useState(pricing.pauseNote ?? "");
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState("");
  // Ticks the paused countdown; doubles as a re-render so an expiry flips
  // the card back to the open state without reopening the panel.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);
  const savedPause = activePause(pricing);

  // Earliest selectable custom resume time (device-local, for datetime-local).
  const customMin = useMemo(() => {
    const d = new Date(Date.now() + 60000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const draftResumeAt = pausePreset === "custom"
    ? (pauseCustomTime ? new Date(pauseCustomTime) : null)
    : typeof pausePreset === "number"
      ? new Date(Date.now() + pausePreset * 60000)
      : null;
  const draftResumeValid = draftResumeAt !== null
    && Number.isFinite(draftResumeAt.getTime())
    && draftResumeAt.getTime() > Date.now();

  const handlePause = async () => {
    if (!draftResumeValid || !draftResumeAt) {
      setPauseError(pausePreset === "custom" ? "Pick a future reopen time." : "Pick a pause duration first.");
      return;
    }
    setPausing(true);
    setPauseError("");
    try {
      if (typeof pausePreset === "number") {
        await onPauseAction({ pauseMinutes: pausePreset, pauseNote: pauseNoteDraft.trim() || null });
      } else {
        await onPauseAction({ pausedUntil: draftResumeAt.toISOString(), pauseNote: pauseNoteDraft.trim() || null });
      }
      setPausePreset(null);
      setPauseCustomTime("");
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : "Unable to pause.");
    } finally {
      setPausing(false);
    }
  };

  const handleResume = async () => {
    setPausing(true);
    setPauseError("");
    try {
      await onPauseAction({ pausedUntil: null, pauseNote: null });
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : "Unable to resume.");
    } finally {
      setPausing(false);
    }
  };

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
          <section className="pricing-section hours-service-card">
            <h3><Timer size={15} aria-hidden="true" /> Temporary pause</h3>
            <span className="pricing-hint">Pauses pickup and delivery together, and reopens on its own. For longer closures use “Accepting new orders” below.</span>
            {savedPause ? (
              <div className="pricing-field">
                <span className="hours-status-badge is-closed">
                  <span className="hours-status-dot" aria-hidden="true" />
                  Paused · {countdownLabel(savedPause.until, nowTick)}
                </span>
                {savedPause.note && <span className="pricing-hint">Showing customers: “{savedPause.note}”</span>}
                <button type="button" className="btn-primary" onClick={handleResume} disabled={pausing}>
                  {pausing ? (
                    <><Loader2 size={16} className="spin" />Resuming…</>
                  ) : (
                    <><Play size={16} />Resume now</>
                  )}
                </button>
              </div>
            ) : (
              <>
                <div className="pricing-field">
                  <label>Pause for</label>
                  <div className="hours-day-pills" role="group" aria-label="Pause duration">
                    {PAUSE_PRESETS_MINUTES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`hours-day-pill ${pausePreset === m ? "active" : ""}`}
                        aria-pressed={pausePreset === m}
                        onClick={() => { setPausePreset(m); setPauseError(""); }}
                      >
                        {m >= 60 ? `${m / 60} hr` : `${m} min`}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`hours-day-pill ${pausePreset === "custom" ? "active" : ""}`}
                      aria-pressed={pausePreset === "custom"}
                      onClick={() => { setPausePreset("custom"); setPauseError(""); }}
                    >
                      Custom
                    </button>
                  </div>
                </div>
                {pausePreset === "custom" && (
                  <div className="pricing-field">
                    <label htmlFor="pause-resume-at">Reopen at</label>
                    <input
                      id="pause-resume-at"
                      type="datetime-local"
                      value={pauseCustomTime}
                      min={customMin}
                      onChange={(e) => { setPauseCustomTime(e.target.value); setPauseError(""); }}
                    />
                  </div>
                )}
                <div className="pricing-field">
                  <label htmlFor="pause-note">Note for customers (optional)</label>
                  <input
                    id="pause-note"
                    type="text"
                    value={pauseNoteDraft}
                    maxLength={120}
                    placeholder="e.g. Out for lunch — back soon"
                    onChange={(e) => setPauseNoteDraft(e.target.value)}
                  />
                </div>
                {pausePreset !== null && (
                  <span className="pricing-hint">
                    Customers will see: “{draftResumeValid && draftResumeAt ? pauseReason(draftResumeAt, pauseNoteDraft.trim() || null) : "…"}”
                  </span>
                )}
                <div className="pricing-field">
                  <button type="button" className="btn-secondary" onClick={handlePause} disabled={pausing || pausePreset === null}>
                    {pausing ? (
                      <><Loader2 size={16} className="spin" />Pausing…</>
                    ) : (
                      <><Pause size={16} />Pause now</>
                    )}
                  </button>
                </div>
              </>
            )}
            {pauseError && <p className="panel-error" role="alert">{pauseError}</p>}
          </section>

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
