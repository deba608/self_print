"use client";

import { CheckSquare, CreditCard, Loader2, Printer, Square, Trash2, X } from "lucide-react";

export default function BatchBar({
  selectedCount,
  totalUnpaid,
  onSelectAll,
  onBatchPaid,
  onBatchRelease,
  onBatchDelete,
  onClear,
  loading,
  releaseLoading,
  deleteLoading,
}: {
  selectedCount: number;
  totalUnpaid: number;
  onSelectAll: () => void;
  onBatchPaid: () => void;
  onBatchRelease: () => void;
  onBatchDelete: () => void;
  onClear: () => void;
  loading: boolean;
  releaseLoading: boolean;
  deleteLoading: boolean;
}) {
  const allSelected = selectedCount === totalUnpaid && totalUnpaid > 0;
  const busy = loading || releaseLoading || deleteLoading;
  const hasSelection = selectedCount > 0;

  return (
    <>
      {/* Inline select-all row — always visible when there are unpaid jobs */}
      <div className="batch-select-row">
        <button type="button" className="batch-select-all-btn" onClick={onSelectAll} disabled={busy}>
          <span className={`batch-select-icon ${allSelected ? "checked" : ""}`}>
            {allSelected ? <CheckSquare size={16} /> : <Square size={16} />}
          </span>
          <span>{allSelected ? "Deselect all" : `Select all (${totalUnpaid})`}</span>
        </button>
        {hasSelection && (
          <span className="batch-selection-hint">
            Tap cards to set print order
          </span>
        )}
      </div>

      {/* Floating action pill — slides up when something is selected */}
      <div className={`batch-float-bar ${hasSelection ? "visible" : ""}`} aria-live="polite">
        <div className="batch-float-inner">

          {/* Left: count badge */}
          <div className="batch-float-info">
            <span className="batch-count-badge">{selectedCount}</span>
            <div className="batch-float-labels">
              <span className="batch-float-title">
                {selectedCount === 1 ? "1 job selected" : `${selectedCount} jobs selected`}
              </span>
              <span className="batch-float-sub">in print order</span>
            </div>
          </div>

          <div className="batch-float-divider" />

          {/* Center: action buttons */}
          <div className="batch-float-actions">
            <button
              type="button"
              className="batch-float-btn release"
              onClick={onBatchRelease}
              disabled={busy}
              title="Release to print queue in selected order"
            >
              {releaseLoading
                ? <Loader2 size={15} className="spin" />
                : <Printer size={15} />}
              <span>Release in order</span>
            </button>

            <button
              type="button"
              className="batch-float-btn paid"
              onClick={onBatchPaid}
              disabled={busy}
              title="Mark all selected as paid"
            >
              {loading
                ? <Loader2 size={15} className="spin" />
                : <CreditCard size={15} />}
              <span>Mark paid</span>
            </button>

            <div className="batch-float-btn-divider" />

            <button
              type="button"
              className="batch-float-btn delete"
              onClick={onBatchDelete}
              disabled={busy}
              title="Permanently delete selected jobs"
            >
              {deleteLoading
                ? <Loader2 size={15} className="spin" />
                : <Trash2 size={15} />}
              <span>Delete</span>
            </button>
          </div>

          {/* Right: dismiss */}
          <button
            type="button"
            className="batch-float-dismiss"
            onClick={onClear}
            disabled={busy}
            aria-label="Clear selection"
          >
            <X size={16} />
          </button>

        </div>
      </div>
    </>
  );
}
