"use client";

import { useEffect, useRef } from "react";

/**
 * Confirmation dialog for destructive or hard-to-reverse actions.
 * Escape closes, backdrop click cancels, confirm button autofocused.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="ui-dialog-backdrop" onClick={onCancel}>
      <div
        className="ui-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ui-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="ui-dialog-title">{title}</h3>
        <p>{message}</p>
        <div className="ui-dialog-actions">
          <button type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`ui-dialog-confirm${danger ? " danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
