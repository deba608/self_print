import { CheckSquare, CreditCard, Loader2, Square, X } from "lucide-react";

export default function BatchBar({
  selectedCount,
  totalUnpaid,
  onSelectAll,
  onBatchPaid,
  onClear,
  loading
}: {
  selectedCount: number;
  totalUnpaid: number;
  onSelectAll: () => void;
  onBatchPaid: () => void;
  onClear: () => void;
  loading: boolean;
}) {
  const allSelected = selectedCount === totalUnpaid && totalUnpaid > 0;

  return (
    <div className="batch-bar">
      <button type="button" className="select-btn" onClick={onSelectAll}>
        {allSelected ? <CheckSquare size={18} /> : <Square size={18} />}
        <span>{allSelected ? "Deselect all" : `Select all unpaid (${totalUnpaid})`}</span>
      </button>

      {selectedCount > 0 && (
        <div className="batch-actions">
          <button type="button" className="batch-btn paid" onClick={onBatchPaid} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <CreditCard size={16} />}
            Mark {selectedCount} paid
          </button>
          <button type="button" className="batch-btn clear" onClick={onClear} aria-label="Clear selection">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
