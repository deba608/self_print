"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, Clock, MoreHorizontal, RefreshCw, Settings } from "lucide-react";

// Collapses Alerts/Refresh/Pricing into one overflow menu at <=480px
// (admin.css shows this trigger and hides the individual buttons at that
// breakpoint) so the topbar row doesn't wrap and push content down.
export default function TopbarMoreMenu({
  newJobCount,
  soundOn,
  onToggleSound,
  onRefresh,
  onOpenPricing,
  showPricing,
  onOpenHours,
  showHours,
}: {
  newJobCount: number;
  soundOn: boolean;
  onToggleSound: () => void;
  onRefresh: () => void;
  onOpenPricing: () => void;
  showPricing: boolean;
  onOpenHours: () => void;
  showHours: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="topbar-more" ref={ref}>
      <button
        type="button"
        className="action-btn topbar-more-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
      >
        <MoreHorizontal size={20} />
        {newJobCount > 0 && <span className="notif-badge">{newJobCount}</span>}
      </button>
      {open && (
        <div className="topbar-more-panel" role="menu">
          <button
            type="button"
            className="topbar-more-item"
            role="menuitem"
            onClick={() => {
              if (newJobCount > 0) onRefresh();
              onToggleSound();
              setOpen(false);
            }}
          >
            {soundOn ? <BellRing size={17} aria-hidden="true" /> : <Bell size={17} aria-hidden="true" />}
            <span>{soundOn ? "Chime on" : "Chime off"}{newJobCount > 0 ? ` — ${newJobCount} new` : ""}</span>
          </button>

          <button
            type="button"
            className="topbar-more-item"
            role="menuitem"
            onClick={() => { onRefresh(); setOpen(false); }}
          >
            <RefreshCw size={17} aria-hidden="true" />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            className={`topbar-more-item ${showPricing ? "active" : ""}`}
            role="menuitem"
            onClick={() => { onOpenPricing(); setOpen(false); }}
          >
            <Settings size={17} aria-hidden="true" />
            <span>Pricing</span>
          </button>

          <button
            type="button"
            className={`topbar-more-item ${showHours ? "active" : ""}`}
            role="menuitem"
            onClick={() => { onOpenHours(); setOpen(false); }}
          >
            <Clock size={17} aria-hidden="true" />
            <span>Hours</span>
          </button>
        </div>
      )}
    </div>
  );
}
