"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Download,
  Lock,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  UserCheck,
  UsersRound,
} from "lucide-react";
import AdminManagementNav from "../AdminManagementNav";
import ManagementSkeleton from "../ui/ManagementSkeleton";
import type { CustomerManagementRow } from "@/lib/types";

export default function CustomerManagementPage() {
  const [customers, setCustomers] = useState<CustomerManagementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authExpired, setAuthExpired] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "registered" | "guest">("all");
  const [exported, setExported] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; isGuest: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/customers", {
        cache: "no-store",
        credentials: "include",
      });
      if (response.status === 401) {
        setAuthExpired(true);
        return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load customers.");
      setCustomers(body.customers ?? []);
      setAuthExpired(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load customers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => ({
    total: customers.length,
    registered: customers.filter((customer) => customer.registeredAt).length,
    active: customers.filter((customer) => customer.activeOrders > 0).length,
    orders: customers.reduce((sum, customer) => sum + customer.totalOrders, 0),
  }), [customers]);

  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return customers.filter((customer) => {
      if (kind === "registered" && !customer.registeredAt) return false;
      if (kind === "guest" && customer.registeredAt) return false;
      if (!normalizedQuery) return true;
      return [
        customer.displayName,
        customer.email,
        customer.phone,
        customer.latestAddress,
      ].some((value) => value?.toLowerCase().includes(normalizedQuery));
    });
  }, [customers, query, kind]);

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/admin/customers/${encodeURIComponent(confirmDelete.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Delete failed");
      setCustomers((prev) => prev.filter((c) => c.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete]);

  const closeConfirm = useCallback(() => {
    setConfirmDelete(null);
    setDeleteError("");
  }, []);

  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) closeConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, deleting, closeConfirm]);

  const exportToCsv = useCallback(() => {
    if (filteredCustomers.length === 0) return;

    const headers = [
      "Customer Name",
      "Customer Type",
      "Email",
      "Phone",
      "Address",
      "Total Orders",
      "Active Orders",
      "Delivery Orders",
      "Delivered Orders",
      "Total Spent (INR)",
      "Last Order Date"
    ];

    const escapeCsvField = (field: string | number | null | undefined): string => {
      if (field === null || field === undefined) return '""';
      const stringValue = String(field);
      const escaped = stringValue.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const rows = filteredCustomers.map((c) => [
      escapeCsvField(c.displayName),
      escapeCsvField(c.registeredAt ? "Registered" : "Guest Delivery"),
      escapeCsvField(c.email ?? ""),
      escapeCsvField(c.phone ?? ""),
      escapeCsvField(c.latestAddress ?? ""),
      escapeCsvField(c.totalOrders),
      escapeCsvField(c.activeOrders),
      escapeCsvField(c.deliveryOrders),
      escapeCsvField(c.deliveredOrders),
      escapeCsvField((c.totalSpentPaise / 100).toFixed(2)),
      escapeCsvField(c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : "")
    ].join(","));

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    link.download = `customers_export_${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExported(true);
    window.setTimeout(() => setExported(false), 2000);
  }, [filteredCustomers]);

  return (
    <AdminManagementNav
      title="User management"
      subtitle="Registered users and delivery customers with order history and contacts."
      actions={
        <button
          type="button"
          className="management-refresh"
          onClick={load}
          disabled={loading}
          title="Refresh customer data"
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      }
    >
      <main className="management-page">
        {authExpired ? (
          <div className="management-locked">
            <Lock size={30} aria-hidden="true" />
            <h2>Admin session expired</h2>
            <p>Sign in again to manage customers.</p>
            <Link href="/admin" className="management-primary-link">Go to admin login</Link>
          </div>
        ) : (
          <>
            <section className="management-kpis" aria-label="Customer overview">
              <article><span className="kpi-icon total"><UsersRound size={19} /></span><div><strong>{summary.total}</strong><small>Known customers</small></div></article>
              <article><span className="kpi-icon active"><UserCheck size={19} /></span><div><strong>{summary.registered}</strong><small>Registered users</small></div></article>
              <article><span className="kpi-icon dispatch"><Truck size={19} /></span><div><strong>{summary.active}</strong><small>With active orders</small></div></article>
              <article><span className="kpi-icon road"><ShoppingBag size={19} /></span><div><strong>{summary.orders}</strong><small>Total orders</small></div></article>
            </section>

            <section className="management-workspace">
              <div className="management-toolbar customer-toolbar">
                <div className="customer-toolbar-row">
                  <label className="management-search" htmlFor="customer-search">
                    <Search size={17} aria-hidden="true" />
                    <span className="sr-only">Search customers</span>
                    <input
                      id="customer-search"
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search by name, email, phone or address…"
                      autoComplete="off"
                    />
                    {query && (
                      <button
                        type="button"
                        className="management-search-clear"
                        onClick={() => setQuery("")}
                        aria-label="Clear search"
                      >
                        &times;
                      </button>
                    )}
                  </label>
                  <div className="management-segmented" role="group" aria-label="Customer type">
                    {(["all", "registered", "guest"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={kind === value ? "active" : ""}
                        onClick={() => setKind(value)}
                      >
                        {value === "all" ? "All" : value === "registered" ? "Registered" : "Guest delivery"}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={`customer-export-btn${exported ? " exported" : ""}`}
                    onClick={exportToCsv}
                    disabled={loading || filteredCustomers.length === 0}
                    title="Export current view to CSV"
                  >
                    {exported ? <Check size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                    <span>{exported ? "Exported" : "Export CSV"}</span>
                  </button>
                </div>
                {(query || kind !== "all") && (
                  <p className="customer-results-count" aria-live="polite">
                    <strong>{filteredCustomers.length}</strong>
                    {filteredCustomers.length === 1 ? " customer" : " customers"} found
                    {query && <> matching <em>&ldquo;{query}&rdquo;</em></>}
                  </p>
                )}
              </div>

              {error && <div className="management-error" role="alert">{error}</div>}

              {loading && customers.length === 0 ? (
                <ManagementSkeleton rows={5} />
              ) : filteredCustomers.length === 0 ? (
                <div className="management-empty">
                  <UsersRound size={28} aria-hidden="true" />
                  <h2>No matching customers</h2>
                  <p>Customer profiles and delivery contacts will appear here after an order.</p>
                </div>
              ) : (
                <div className="customer-management-grid">
                  {filteredCustomers.map((customer) => (
                    <article className="customer-management-card" key={customer.id}>
                      <header>
                        <span className="customer-avatar">
                          {customer.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "CU"}
                        </span>
                        <div>
                          <div className="customer-title-line">
                            <h2>{customer.displayName}</h2>
                            <span className={customer.registeredAt ? "registered" : "guest"}>
                              {customer.registeredAt ? "Registered" : "Guest delivery"}
                            </span>
                          </div>
                          {customer.lastOrderAt && (
                            <p><CalendarDays size={13} /> Last order {new Date(customer.lastOrderAt).toLocaleDateString()}</p>
                          )}
                        </div>
                      </header>

                      <div className="customer-contact-list">
                        {customer.email && <a href={`mailto:${customer.email}`}><Mail size={15} /> {customer.email}</a>}
                        {customer.phone && <a href={`tel:${customer.phone}`}><Phone size={15} /> {customer.phone}</a>}
                        {customer.latestAddress && <p><MapPin size={15} /> <span>{customer.latestAddress}</span></p>}
                      </div>

                      <dl className="customer-order-stats">
                        <div><dt>Orders</dt><dd>{customer.totalOrders}</dd></div>
                        <div><dt>Active</dt><dd>{customer.activeOrders}</dd></div>
                        <div><dt>Deliveries</dt><dd>{customer.deliveryOrders}</dd></div>
                        <div><dt>Total spent</dt><dd>₹{(customer.totalSpentPaise / 100).toFixed(2)}</dd></div>
                      </dl>

                      <footer>
                        {customer.phone
                          ? <a href={`tel:${customer.phone}`}><Phone size={14} /> Call customer</a>
                          : customer.email
                            ? <a href={`mailto:${customer.email}`}><Mail size={14} /> Email customer</a>
                            : <span>No contact details</span>}
                        <Link href={`/admin/orders?customer=${encodeURIComponent(customer.phone || customer.email || customer.displayName)}`}>
                          View orders
                        </Link>
                        <button
                          type="button"
                          className="customer-delete-btn"
                          title="Remove customer"
                          onClick={() => setConfirmDelete({
                            id: customer.id,
                            name: customer.displayName,
                            isGuest: !customer.registeredAt,
                          })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {confirmDelete && (
        <div
          className="customer-delete-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm customer removal"
          onClick={(event) => { if (event.target === event.currentTarget && !deleting) closeConfirm(); }}
        >
          <div className="customer-delete-dialog">
            <span className="customer-delete-icon" aria-hidden="true"><Trash2 size={20} /></span>
            <h3>{confirmDelete.isGuest ? "Remove guest customer?" : "Remove customer?"}</h3>
            <p>
              {confirmDelete.isGuest ? (
                <>
                  <strong>{confirmDelete.name}</strong> is a guest with no account. Their name, phone
                  and delivery address will be erased from past orders. The orders themselves remain.
                </>
              ) : (
                <>
                  <strong>{confirmDelete.name}</strong> will be permanently deleted along with their
                  account and they will no longer be able to sign in. Their past orders remain in the system.
                </>
              )}
            </p>
            {deleteError && (
              <p className="customer-delete-err" role="alert">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{deleteError}</span>
              </p>
            )}
            <div className="customer-delete-actions">
              <button
                type="button"
                className="customer-delete-cancel"
                onClick={closeConfirm}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="customer-delete-confirm"
                onClick={doDelete}
                disabled={deleting}
              >
                {deleting ? "Removing…" : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminManagementNav>
  );
}
