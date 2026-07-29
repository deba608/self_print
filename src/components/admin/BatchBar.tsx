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

  return (
    <div className="batch-bar">
      <button type="button" className="select-btn" onClick={onSelectAll} disabled={busy}>
        {allSelected ? <CheckSquare size={18} /> : <Square size={18} />}
        <span>{allSelected ? "Deselect all" : `Select all unpaid (${totalUnpaid})`}</span>
      </button>

      {selectedCount > 0 && (
        <div className="batch-actions">
          <button
            type="button"
            className="batch-btn release"
            onClick={onBatchRelease}
            disabled={busy}
            title="Release selected jobs to the print queue in the order you selected them"
          >
            {releaseLoading ? <Loader2 size={16} className="spin" /> : <Printer size={16} />}
            Release {selectedCount} in order
          </button>
          <button
            type="button"
            className="batch-btn paid"
            onClick={onBatchPaid}
            disabled={busy}
            title="Mark selected jobs as paid"
          >
            {loading ? <Loader2 size={16} className="spin" /> : <CreditCard size={16} />}
            Mark {selectedCount} paid
          </button>
          <button
            type="button"
            className="batch-btn delete"
            onClick={onBatchDelete}
            disabled={busy}
            title="Permanently delete selected jobs and their files"
          >
            {deleteLoading ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
            Delete {selectedCount}
          </button>
          <button type="button" className="batch-btn clear" onClick={onClear} aria-label="Clear selection" disabled={busy}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
