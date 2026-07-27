"use client";

import { useEffect, useRef, useState } from "react";
import { Inbox, TrendingUp } from "lucide-react";

// Animates a numeric value toward its target over ~450ms so stat changes
// count up/down instead of jumping.
function useCountUp(target: number): number {
  const [display, setDisplay] = useState(target);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const dur = 450;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (target - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); fromRef.current = target; };
  }, [target]);
  return display;
}

export default function StatsBar({ activeJobs, todayRevenue }: { activeJobs: number; todayRevenue: number }) {
  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
  const animatedJobs = useCountUp(activeJobs);
  const animatedRevenue = useCountUp(todayRevenue);

  return (
    <div className="stats-bar">
      <div className="stat-pill">
        <Inbox size={13} className="stat-pill-icon" />
        <span className="stat-pill-label">Active</span>
        <span className="stat-pill-value">{Math.round(animatedJobs)}</span>
      </div>
      <div className="stat-pill">
        <TrendingUp size={13} className="stat-pill-icon" />
        <span className="stat-pill-label">Revenue</span>
        <span className="stat-pill-value">{formatRupees(animatedRevenue)}</span>
      </div>
    </div>
  );
}
