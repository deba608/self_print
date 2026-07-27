"use client";

import { useCallback, useRef, useState } from "react";
import { Check, X } from "lucide-react";

export type ToastKind = "ok" | "err";
type ToastItem = { id: number; kind: ToastKind; msg: string; leaving?: boolean };

/**
 * Auto-dismiss toast queue. Call the returned `push` function to enqueue a
 * message; render `<ToastStack toasts={toasts} />` once, anywhere in the tree.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback((kind: ToastKind, msg: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, kind, msg }]);
    setTimeout(() => setToasts((prev) => prev.map((t) => t.id === id ? { ...t, leaving: true } : t)), 3200);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  return { toasts, push };
}

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind} ${t.leaving ? "leaving" : ""}`}>
          {t.kind === "ok" ? <Check size={16} /> : <X size={16} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}
