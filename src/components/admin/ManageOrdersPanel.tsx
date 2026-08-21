"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckSquare, Loader2, ListTodo, Printer, RotateCcw, Square, Trash2, X } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export type ManageJob = {
  id: string;
  token: string;
  status: string;
  pricePaise: number;
  createdAt: string;
  file: { originalName: string } | undefined;
};

export default function ManageOrdersPanel({
  jobs,
  onClose,
  onRefresh
}: {
  jobs: ManageJob[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");

  const filteredJobs = filterStatus === "all" ? jobs : jobs.filter((j) => j.status === filterStatus);

  const statusCounts = jobs.reduce((acc, j) => {
    acc[j.status] = (acc[j.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const formatRupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

  const statusLabels: Record<string, string> = {
    pending_payment: "Unpaid",
    paid: "Paid",
    approved: "Ready",
    printing: "Printing",
    printed: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  };

  async function deleteJob(jobId: string) {
    setDeleteLoading(jobId);
    try {
      const response = await fetch(`/api/admin/jobs/${jobId}`, { method: "DELETE", credentials: "include" });
      if (response.status === 401) {
        router.push("/admin");
        return;
      }
      if (response.ok) {
        setConfirmDelete(null);
        setLeavingIds((prev) => new Set(prev).add(jobId));
        setTimeout(() => {
          onRefresh();
          setLeavingIds((prev) => { const next = new Set(prev); next.delete(jobId); return next; });
        }, 260);
      }
    } finally {
      setDeleteLoading(null);
    }
  }

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      const response = await fetch("/api/admin/jobs/bulk-delete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
      });
      if (response.status === 401) {
        router.push("/admin");
        return;
      }
      if (response.ok) {
        setSelectedIds(new Set());
        setConfirmBulkDelete(false);
        setLeavingIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.add(id)); return next; });
        setTimeout(() => {
          onRefresh();
          setLeavingIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
        }, 260);
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  async function restoreAll() {
    setRestoring(true);
    setRestoreMsg("");
    try {
      const response = await fetch("/api/admin/jobs/restore-all", { method: "POST", credentials: "include" });
      if (response.status === 401) {
        router.push("/admin");
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setRestoreMsg(data.restored > 0 ? `Restored ${data.restored} order${data.restored === 1 ? "" : "s"}.` : "No deleted orders to restore.");
        onRefresh();
      } else {
        setRestoreMsg(data.error ?? "Could not restore orders.");
      }
    } catch {
      setRestoreMsg("Could not restore orders.");
    } finally {
      setRestoring(false);
    }
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function selectAll() {
    const allIds = filteredJobs.map((j) => j.id);
    const allSelected = selectedIds.size === allIds.length && allIds.length > 0;
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="manage-orders-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <ListTodo size={20} className="panel-icon" />
            <h2>Manage Orders</h2>
          </div>
          <button
            type="button"
            className="manage-restore-all-btn"
            onClick={restoreAll}
            disabled={restoring}
            title="Bring back every order previously deleted from this list"
          >
            {restoring ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
            Restore all deleted
          </button>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {restoreMsg && <p className="manage-restore-msg">{restoreMsg}</p>}

        <div className="manage-orders-filters">
          <button
            type="button"
            className={`manage-filter-tab ${filterStatus === "all" ? "active" : ""}`}
            onClick={() => setFilterStatus("all")}
          >
            All <span className="manage-filter-count">{jobs.length}</span>
          </button>
          {Object.entries(statusLabels).map(([status, label]) => (
            statusCounts[status] > 0 && (
              <button
                type="button"
                key={status}
                className={`manage-filter-tab ${filterStatus === status ? "active" : ""}`}
                onClick={() => setFilterStatus(status)}
              >
                {label} <span className="manage-filter-count">{statusCounts[status]}</span>
              </button>
            )
          ))}
        </div>

        {selectedIds.size > 0 && (
          <div className="manage-bulk-bar">
            <span>{selectedIds.size} selected</span>
            <div className="manage-bulk-actions">
              <button
                type="button"
                className="bulk-delete-btn"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={bulkDeleting}
              >
                {bulkDeleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                Delete Selected
              </button>
              <button type="button" className="bulk-clear-btn" onClick={() => setSelectedIds(new Set())} aria-label="Clear selection">
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="manage-orders-list">
          <button type="button" className="manage-select-all" onClick={selectAll}>
            {selectedIds.size === filteredJobs.length && filteredJobs.length > 0 ? (
              <CheckSquare size={16} />
            ) : (
              <Square size={16} />
            )}
            <span>Select all ({filteredJobs.length})</span>
          </button>

          {filteredJobs.length === 0 ? (
            <div className="manage-empty">
              <Printer size={32} strokeWidth={1} />
              <p>No orders found</p>
            </div>
          ) : (
            filteredJobs.map((job) => (
              <div key={job.id} className={`manage-order-item ${leavingIds.has(job.id) ? "leaving" : ""}`}>
                <button
                  className={`manage-order-checkbox ${selectedIds.has(job.id) ? "selected" : ""}`}
                  onClick={() => toggleSelect(job.id)}
                  type="button"
                  aria-label={selectedIds.has(job.id) ? `Deselect order ${job.token}` : `Select order ${job.token}`}
                >
                  <span className={`checkbox-circle checkbox-circle-sm ${selectedIds.has(job.id) ? "checked" : ""}`}>
                    {selectedIds.has(job.id) && <Check size={12} strokeWidth={3.5} />}
                  </span>
                </button>
                <div className="manage-order-info">
                  <div className="manage-order-header">
                    <span className="manage-order-token">Token {job.token}</span>
                    <span className="manage-order-status">{statusLabels[job.status] || job.status}</span>
                  </div>
                  <div className="manage-order-details">
                    <span className="manage-order-file">{job.file?.originalName || "No file"}</span>
                    <span className="manage-order-price">{formatRupees(job.pricePaise)}</span>
                  </div>
                  <div className="manage-order-time">
                    {new Date(job.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="manage-order-delete"
                  onClick={() => setConfirmDelete(job.id)}
                  disabled={deleteLoading === job.id}
                  aria-label="Delete order"
                >
                  {deleteLoading === job.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                </button>

              </div>
            ))
          )}
        </div>

        <ConfirmDialog
          open={confirmDelete !== null}
          title="Delete order?"
          message="This order and its files will be permanently removed. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => { const id = confirmDelete; setConfirmDelete(null); if (id) deleteJob(id); }}
          onCancel={() => setConfirmDelete(null)}
        />
        <ConfirmDialog
          open={confirmBulkDelete}
          title={`Delete ${selectedIds.size} order${selectedIds.size === 1 ? "" : "s"}?`}
          message="This action cannot be undone. All files and records will be permanently removed."
          confirmLabel={bulkDeleting ? "Deleting..." : "Delete All"}
          danger
          onConfirm={() => { if (!bulkDeleting) bulkDelete(); }}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      </div>
    </div>
  );
}
