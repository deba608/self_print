"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Loader2, Smartphone, X } from "lucide-react";
import { loadRazorpayCheckout, type Pricing } from "./upload/shared";

type Props = {
  token: string;
  pricePaise: number;
  paidAt: string | null;
  status: string;
};

const CANCELLABLE = ["pending_payment", "paid", "approved"];

export default function JobActions({ token, pricePaise, paidAt: initialPaidAt, status: initialStatus }: Props) {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [paidAt, setPaidAt] = useState(initialPaidAt);
  const [status, setStatus] = useState(initialStatus);
  const [payState, setPayState] = useState<"idle" | "processing">("idle");
  const [payError, setPayError] = useState("");
  const [cancelState, setCancelState] = useState<"idle" | "confirm" | "cancelling">("idle");
  const [cancelError, setCancelError] = useState("");
  const [refundStatus, setRefundStatus] = useState<"processing" | "refunded" | "failed" | null>(null);

  useEffect(() => {
    fetch("/api/pricing")
      .then((r) => (r.ok ? r.json() : null))
      .then(setPricing)
      .catch(() => {});
  }, []);

  async function payNow() {
    setPayError("");
    setPayState("processing");

    const loaded = await loadRazorpayCheckout();
    if (!loaded) {
      setPayState("idle");
      setPayError("Could not load the payment window. Check your connection and retry.");
      return;
    }

    let order: { orderId: string; amount: number; currency: string; keyId: string };
    try {
      const res = await fetch("/api/payments/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.alreadyPaid) {
        setPayState("idle");
        setPaidAt(new Date().toISOString());
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Could not start payment.");
      order = data;
    } catch (err) {
      setPayState("idle");
      setPayError(err instanceof Error ? err.message : "Could not start payment.");
      return;
    }

    const rzp = new (window as any).Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: pricing?.shopName ?? "Print Shop",
      description: `Token ${token}`,
      theme: { color: "#2563eb" },
      handler: async (response: any) => {
        try {
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...response, token }),
          });
          if (!verifyRes.ok) throw new Error("Payment could not be verified.");
          setPayState("idle");
          setPaidAt(new Date().toISOString());
        } catch (err) {
          setPayState("idle");
          setPayError(err instanceof Error ? err.message : "Payment verification failed. Show the counter your payment.");
        }
      },
      modal: { ondismiss: () => setPayState("idle") },
    });
    rzp.on("payment.failed", (resp: any) => {
      setPayState("idle");
      setPayError(resp?.error?.description ?? "Payment failed. Please try again.");
    });
    rzp.open();
  }

  async function cancelJob() {
    setCancelState("cancelling");
    setCancelError("");
    try {
      const res = await fetch(`/api/jobs/${token}/cancel`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not cancel this order.");
      setStatus("cancelled");
      setCancelState("idle");
      if (data.refundStatus) setRefundStatus(data.refundStatus);
    } catch (err) {
      setCancelState("confirm");
      setCancelError(err instanceof Error ? err.message : "Could not cancel this order.");
    }
  }

  if (status === "cancelled" && refundStatus) {
    return refundStatus === "refunded" ? (
      <span className="job-actions-refunded">
        <CircleCheck size={14} aria-hidden="true" /> Refunded
      </span>
    ) : (
      <span className="job-actions-refund-pending">Cancelled — refund pending, contact the counter</span>
    );
  }

  if (paidAt) {
    return (
      <span className="job-actions-paid">
        <CircleCheck size={14} aria-hidden="true" /> Paid
      </span>
    );
  }

  const canPay = Boolean((pricing?.razorpayKeyId ?? "").trim()) && pricePaise >= 100 && status !== "cancelled";
  const canCancel = CANCELLABLE.includes(status);

  return (
    <div className="job-actions-group">
      {canPay && (
        <button type="button" className="job-actions-pay-btn" onClick={payNow} disabled={payState === "processing"}>
          {payState === "processing" ? (
            <><Loader2 size={14} className="spin" aria-hidden="true" /> Opening…</>
          ) : (
            <><Smartphone size={14} aria-hidden="true" /> Pay ₹{(pricePaise / 100).toFixed(2)}</>
          )}
        </button>
      )}

      {canCancel && cancelState === "idle" && (
        <button type="button" className="job-actions-cancel-btn" onClick={() => setCancelState("confirm")}>
          <X size={14} aria-hidden="true" /> Cancel
        </button>
      )}

      {canCancel && cancelState !== "idle" && (
        <div className="job-actions-cancel-confirm">
          <span>{paidAt ? "Cancel & refund this order?" : "Cancel this order?"}</span>
          <button type="button" className="job-actions-cancel-yes" onClick={cancelJob} disabled={cancelState === "cancelling"}>
            {cancelState === "cancelling" ? <Loader2 size={13} className="spin" aria-hidden="true" /> : "Yes, cancel"}
          </button>
          <button type="button" className="job-actions-cancel-no" onClick={() => setCancelState("idle")}>
            No
          </button>
        </div>
      )}

      {payError && <p className="pay-error job-actions-error" role="alert">{payError}</p>}
      {cancelError && <p className="pay-error job-actions-error" role="alert">{cancelError}</p>}
    </div>
  );
}
