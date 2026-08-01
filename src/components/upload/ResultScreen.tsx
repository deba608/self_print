"use client";

import { useEffect, useState } from "react";
import { Check, Copy, CreditCard, Loader2, Printer, Search, Smartphone, Star, Store, Truck, UploadCloud, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import BillReceipt, { type BillData } from "../BillReceipt";
import { loadRazorpayCheckout, type Pricing } from "./shared";

export type JobResult = {
  token: string;
  pricePaise: number;
  needsConversion: boolean;
  queuePosition: number;
  pageCount?: number;
};

// The token/payment/live-status screen shown after a job is submitted. Owns
// every bit of payment + polling state — unmounting it (Upload Another) resets
// everything for free.
export default function ResultScreen({
  result,
  pricing,
  deliveryMethod,
  billFiles,
  settings,
  onReset,
}: {
  result: JobResult;
  pricing: Pricing | null;
  deliveryMethod: "pickup" | "delivery";
  billFiles: { name: string; pages: number }[];
  settings: { printType: string; duplex: string; paperSize: string; copies: number; pagesPerSheet: number };
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [payState, setPayState] = useState<"idle" | "processing" | "paid">("idle");
  // Set once payment is confirmed (Razorpay success, or staff marking the job
  // paid — detected by polling). Switches the token screen to the receipt.
  const [paidInfo, setPaidInfo] = useState<{ method: "online" | "counter"; at: string } | null>(null);
  const [payError, setPayError] = useState("");
  const [payMethod, setPayMethod] = useState<"online" | "offline" | null>(null);

  // Live status for the mini-timeline at the bottom of the token screen, and
  // the paid-detection that flips this phone to the receipt. One poll serves
  // both: runs while the token screen is up, stops once the job is printed
  // (or leaves the normal flow — failed/cancelled).
  const [liveStatus, setLiveStatus] = useState<{
    status: string;
    paidAt: string | null;
    queuePosition?: number;
    jobsAhead?: number;
    deliveryStatus?: "out_for_delivery" | "delivered" | null;
  } | null>(null);
  useEffect(() => {
    if (result.needsConversion) return;
    if (liveStatus) {
      const terminalFailure = !["pending_payment", "paid", "approved", "printing", "printed"].includes(liveStatus.status);
      const orderComplete = deliveryMethod === "delivery"
        ? liveStatus.status === "printed" && liveStatus.deliveryStatus === "delivered"
        : liveStatus.status === "printed";
      if (terminalFailure || orderComplete) return;
    }
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${result.token}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        setLiveStatus({
          status: body.status,
          paidAt: body.paidAt ?? null,
          queuePosition: body.queuePosition,
          jobsAhead: body.jobsAhead,
          deliveryStatus: body.deliveryStatus ?? null,
        });
        if (body.paidAt) {
          setPaidInfo((p) => p ?? {
            method: deliveryMethod === "delivery" ? "online" : "counter",
            at: body.paidAt,
          });
        }
      } catch {
        /* transient network error — next tick retries */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [result, liveStatus, deliveryMethod]);

  const { printType, duplex, paperSize, copies, pagesPerSheet } = settings;
  const amountRupees = (result.pricePaise / 100).toFixed(2);
  const upiId = (pricing?.shopUpiId ?? "").trim();
  const upiQr = (pricing?.shopUpiQr ?? "").trim();
  const shopName = pricing?.shopName ?? "Print Shop";
  const reviewUrl = (pricing?.shopReviewUrl ?? "").trim();

  // Receipt data — everything is already in client state at this point.
  const billPerPage = pricing
    ? (duplex !== "simplex" && printType === "bw" && pricing.duplexBwPerPagePaise
        ? pricing.duplexBwPerPagePaise
        : printType === "bw" ? pricing.bwPerPagePaise : pricing.colorPerPagePaise)
    : 0;
  const billData: BillData = {
    shopName,
    token: result.token,
    queuePosition: result.queuePosition,
    files: billFiles,
    settings: { printType, duplex, paperSize, copies, pagesPerSheet },
    totalPaise: result.pricePaise,
    perPagePaise: billPerPage,
    totalPages: result.pageCount || billFiles.reduce((s, f) => s + f.pages, 0),
    paidVia: paidInfo?.method ?? "counter",
    paidAt: paidInfo?.at ?? new Date().toISOString(),
  };

  // Build the UPI intent link.
  // Merchant/aggregator stickers (GetePay, Paytm, etc.) carry signed params
  // (mc, mode, sign, tr) that a rebuilt link would drop — so the payee VPA
  // rejects it. When SHOP_UPI_QR holds the sticker's exact decoded string we
  // pass it through verbatim and only inject the amount + token note.
  // Otherwise fall back to building a plain link from SHOP_UPI_ID.
  let upiLink = "";
  if (upiQr.startsWith("upi://")) {
    const [base, query = ""] = upiQr.split("?");
    const params = new URLSearchParams(query);
    params.set("am", amountRupees);
    params.set("cu", "INR");
    params.set("tn", "Token " + result.token);
    upiLink = `${base}?${params.toString()}`;
  } else if (upiId) {
    upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shopName)}&am=${amountRupees}&tn=${encodeURIComponent("Token " + result.token)}&cu=INR`;
  }

  const upiId_forCopy = upiQr.startsWith("upi://")
    ? new URLSearchParams(upiQr.split("?")[1] ?? "").get("pa") ?? ""
    : upiId;

  const copyUpiId = async () => {
    try {
      await navigator.clipboard.writeText(upiId_forCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };

  const razorpayKeyId = (pricing?.razorpayKeyId ?? "").trim();
  const showRazorpay = Boolean(razorpayKeyId) && !result.needsConversion && result.pricePaise >= 100;
  // Online payment (UPI QR or Razorpay) is offered as a choice alongside cash
  // for pickup orders. Delivery orders skip the counter entirely, so they
  // must pay online — no cash choice, no counter fallback.
  const isDeliveryOrder = deliveryMethod === "delivery";
  const onlineAvailable = !result.needsConversion && (Boolean(upiLink) || showRazorpay);

  async function startRazorpayPayment() {
    if (!result) return;
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
        body: JSON.stringify({ token: result.token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.alreadyPaid) {
        setPayState("paid");
        setPaidInfo((p) => p ?? { method: "online", at: new Date().toISOString() });
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
      name: shopName,
      description: `Token ${result.token}`,
      theme: { color: "#2563eb" },
      // UPI-only: UPI has 0% MDR (zero-MDR mandate), cards/netbanking/wallets
      // carry ~2% — so hide everything except UPI to stay fee-free.
      method: {
        upi: true,
        card: false,
        netbanking: false,
        wallet: false,
        emi: false,
        paylater: false,
      },
      handler: async (response: any) => {
        try {
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...response, token: result.token }),
          });
          if (!verifyRes.ok) throw new Error("Payment could not be verified.");
          setPayState("paid");
          setPaidInfo({ method: "online", at: new Date().toISOString() });
          setPayError("");
        } catch (err) {
          setPayState("idle");
          setPayError(err instanceof Error ? err.message : "Payment verification failed. Show the counter your payment.");
        }
      },
      modal: {
        ondismiss: () => {
          // Customer closed the window without paying — allow a retry.
          setPayState((s) => (s === "paid" ? s : "idle"));
        },
      },
    });
    rzp.on("payment.failed", (resp: any) => {
      setPayState("idle");
      setPayError(resp?.error?.description ?? "Payment failed. Please try again.");
    });
    rzp.open();
  }

  return (
    <div className="result-screen result-success" role="status" aria-live="polite">
      <div className="success-animation" aria-hidden="true">
        <div className="success-icon" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <polyline className="check-draw" points="10 25 20 35 38 14" />
          </svg>
        </div>
        <div className="success-burst"></div>
      </div>
      <h2 className="success-title">Print Job Submitted</h2>

      {/* Token + queue summary */}
      <div className="result-meta">
        <div className="result-meta-item">
          <span className="result-meta-label">Token</span>
          <span className="result-meta-value token-value bounce-in">{result.token}</span>
        </div>
        <div className="result-meta-divider" aria-hidden="true" />
        <div className="result-meta-item">
          <span className="result-meta-label">Queue</span>
          <span className="result-meta-value queue-pulse">#{result.queuePosition}</span>
        </div>
      </div>

      {paidInfo ? (
        <>
          <BillReceipt bill={billData} />
          {isDeliveryOrder && (
            <div className="delivery-paid-note">
              <Truck size={18} aria-hidden="true" />
              <div>
                <strong>Payment received</strong>
                <p>The shop will print your order and update delivery progress here.</p>
              </div>
            </div>
          )}
        </>
      ) : result.needsConversion ? (
        <div className="counter-card">
          <span className="upi-tag"><Store size={13} aria-hidden="true" /> Pay at Counter</span>
          <p className="counter-msg">
            Your file needs conversion. Show your token at the counter to collect it.
          </p>
          <ol className="upi-steps">
            <li><span className="upi-step-num">1</span> Show token <strong>{result.token}</strong> to staff</li>
            <li><span className="upi-step-num">2</span> Staff prints your file</li>
            <li><span className="upi-step-num">3</span> Collect your print</li>
          </ol>
        </div>
      ) : onlineAvailable ? (
        <>
          {/* Payment method chooser */}
          {!isDeliveryOrder && (
            <div className="pay-choice" role="group" aria-label="Choose how to pay">
              <button
                type="button"
                className={`pay-choice-btn ${payMethod === "online" ? "active" : ""}`}
                onClick={() => { setPayError(""); setPayMethod("online"); }}
                aria-pressed={payMethod === "online"}
              >
                <Smartphone size={22} aria-hidden="true" />
                <span className="pay-choice-title">Pay Online</span>
                <span className="pay-choice-sub">UPI / QR</span>
              </button>
              <button
                type="button"
                className={`pay-choice-btn ${payMethod === "offline" ? "active" : ""}`}
                onClick={() => { setPayError(""); setPayMethod("offline"); }}
                aria-pressed={payMethod === "offline"}
              >
                <Store size={22} aria-hidden="true" />
                <span className="pay-choice-title">Pay Cash</span>
                <span className="pay-choice-sub">At counter</span>
              </button>
            </div>
          )}

          {!isDeliveryOrder && payMethod === null && (
            <p className="pay-hint">Select a payment method above</p>
          )}

          {(payMethod === "online" || isDeliveryOrder) && (
            showRazorpay ? (
              <div className="upi-card">
                <div className="upi-card-top">
                  <span className="upi-tag"><CreditCard size={13} aria-hidden="true" /> Online Payment</span>
                  <div className="upi-amount">₹{amountRupees}</div>
                  <p className="upi-payee">to {shopName}</p>
                </div>

                {payState === "paid" ? (
                  <div className="pay-done" role="status">
                    <Check size={20} aria-hidden="true" />
                    <span>
                      {isDeliveryOrder
                        ? "Payment received — your order will now be prepared for delivery."
                        : "Payment received — show this screen to staff."}
                    </span>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="upi-pay-btn"
                      onClick={startRazorpayPayment}
                      disabled={payState === "processing"}
                    >
                      {payState === "processing" ? (
                        <><Loader2 size={20} className="spin" aria-hidden="true" /> Opening…</>
                      ) : (
                        <><Smartphone size={20} aria-hidden="true" /> Pay ₹{amountRupees} now</>
                      )}
                    </button>
                    <p className="upi-apps">GPay · PhonePe · Paytm · BHIM &amp; all UPI apps</p>
                    {payError && <p className="pay-error" role="alert">{payError}</p>}
                  </>
                )}

                <ol className="upi-steps">
                  <li><span className="upi-step-num">1</span> Tap Pay and complete payment</li>
                  <li><span className="upi-step-num">2</span> {isDeliveryOrder ? "The shop prepares your prints" : "Show this screen to staff"}</li>
                  <li><span className="upi-step-num">3</span> {isDeliveryOrder ? "Track dispatch and delivery here" : "Collect your print"}</li>
                </ol>
              </div>
            ) : (
              <div className="upi-card">
                <div className="upi-card-top">
                  <span className="upi-tag"><CreditCard size={13} aria-hidden="true" /> UPI Payment</span>
                  <div className="upi-amount">₹{amountRupees}</div>
                  <p className="upi-payee">to {shopName}</p>
                </div>

                {/* QR payment — intent links get blocked by UPI risk policy
                    for this VPA, so scan-to-pay is the only offered flow. */}
                <div className="upi-qr-box">
                  <QRCodeSVG value={upiLink} size={184} level="M" marginSize={2} />
                </div>
                <p className="upi-apps">Scan with GPay · PhonePe · Paytm · BHIM &amp; all UPI apps</p>

                {/* Manual fallback — copy the UPI ID */}
                <button type="button" className="upi-copy" onClick={copyUpiId} aria-live="polite">
                  {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                  <span className="upi-copy-id">{copied ? "Copied!" : upiId_forCopy}</span>
                </button>

                <ol className="upi-steps">
                  <li><span className="upi-step-num">1</span> On this phone? Screenshot the QR, then scan it from gallery in your UPI app</li>
                  <li><span className="upi-step-num">2</span> Pay ₹{amountRupees}{isDeliveryOrder ? "" : " and show this screen to staff"}</li>
                  <li><span className="upi-step-num">3</span> {isDeliveryOrder ? "Track preparation and delivery here" : "Collect your print"}</li>
                </ol>
              </div>
            )
          )}

          {payMethod === "offline" && (
            <div className="counter-card">
              <span className="upi-tag"><Store size={13} aria-hidden="true" /> Pay at Counter</span>
              <div className="upi-amount">₹{amountRupees}</div>
              <p className="counter-msg">Pay in cash at the counter, then collect your print.</p>
              <ol className="upi-steps">
                <li><span className="upi-step-num">1</span> Show token <strong>{result.token}</strong> to staff</li>
                <li><span className="upi-step-num">2</span> Pay ₹{amountRupees} in cash</li>
                <li><span className="upi-step-num">3</span> Collect your print</li>
              </ol>
            </div>
          )}
        </>
      ) : isDeliveryOrder ? (
        <div className="counter-card">
          <span className="upi-tag"><CreditCard size={13} aria-hidden="true" /> Online Payment Required</span>
          <div className="upi-amount">₹{amountRupees}</div>
          <p className="counter-msg">
            Online payment is temporarily unavailable. Your order is saved; retry from this page or contact the shop before delivery.
          </p>
        </div>
      ) : (
        <div className="counter-card">
          <span className="upi-tag"><Store size={13} aria-hidden="true" /> Pay at Counter</span>
          <div className="upi-amount">₹{amountRupees}</div>
          <p className="counter-msg">Pay at the counter, then collect your print.</p>
          <ol className="upi-steps">
            <li><span className="upi-step-num">1</span> Show token <strong>{result.token}</strong> to staff</li>
            <li><span className="upi-step-num">2</span> Pay ₹{amountRupees}</li>
            <li><span className="upi-step-num">3</span> Collect your print</li>
          </ol>
        </div>
      )}

      {/* Live status of this token — polls every 5s, animates as staff
          move the job through the queue. */}
      {!result.needsConversion && (() => {
        const st = liveStatus?.status ?? "pending_payment";
        const paid = Boolean(liveStatus?.paidAt) || Boolean(paidInfo);
        const failed = !["pending_payment", "paid", "approved", "printing", "printed"].includes(st);
        const printStarted = st === "approved" || st === "printing" || st === "printed";
        const printComplete = st === "printed";
        const dispatched = liveStatus?.deliveryStatus === "out_for_delivery" || liveStatus?.deliveryStatus === "delivered";
        const delivered = liveStatus?.deliveryStatus === "delivered";
        const done = isDeliveryOrder
          ? [true, paid, printComplete, dispatched, delivered]
          : [true, paid, printStarted, printComplete];
        const activeIdx = done.findIndex((d) => !d);
        // jobsAhead is a live count (recomputed every poll) of active jobs
        // still ahead of this one — unlike queuePosition, a fixed ticket
        // number assigned at creation that never decreases.
        const jobsAhead = liveStatus?.jobsAhead ?? Math.max(0, result.queuePosition - 1);
        const miniSteps = isDeliveryOrder
          ? [
              { label: "Submitted", icon: <UploadCloud size={15} /> },
              { label: "Paid", icon: <CreditCard size={15} /> },
              { label: "Printed", icon: <Printer size={15} /> },
              { label: "Dispatch", icon: <Truck size={15} /> },
              { label: "Delivered", icon: <Check size={15} /> },
            ]
          : [
              { label: "Submitted", icon: <UploadCloud size={15} /> },
              { label: "Paid", icon: <CreditCard size={15} /> },
              { label: "Printing", icon: <Printer size={15} /> },
              { label: "Ready", icon: <Check size={15} /> },
            ];
        return (
          <div className="mini-track" aria-live="polite">
            <div className="mini-track-head">
              <span className="mini-track-title">Live status</span>
              {st !== "printed" && !failed && (
                <span className="mini-track-eta">~{Math.max(1, jobsAhead + 1) * 3} min wait</span>
              )}
            </div>
            {failed ? (
              <p className="mini-track-failed" role="alert">
                <X size={15} aria-hidden="true" /> Order {st === "cancelled" ? "cancelled" : "needs attention"} — ask staff with token {result.token}
              </p>
            ) : (
              <div className="mini-timeline">
                {miniSteps.map((s, i) => {
                  const state = done[i] ? "done" : i === activeIdx ? "active" : "todo";
                  return (
                    <div key={s.label} className={`mini-step ${state}`}>
                      <span className="mini-step-dot" aria-hidden="true">
                        {state === "done" ? <Check size={13} strokeWidth={3.5} /> : s.icon}
                      </span>
                      <span className="mini-step-label">{s.label}</span>
                      {i < miniSteps.length - 1 && <span className={`mini-step-line ${done[i] ? "filled" : ""}`} aria-hidden="true" />}
                    </div>
                  );
                })}
              </div>
            )}
            {st === "printed" && isDeliveryOrder && delivered && (
              <p className="track-collect"><Check size={14} aria-hidden="true" /> Delivered successfully</p>
            )}
            {st === "printed" && isDeliveryOrder && dispatched && !delivered && (
              <p className="track-collect"><Truck size={14} aria-hidden="true" /> Your order is out for delivery</p>
            )}
            {st === "printed" && isDeliveryOrder && !dispatched && (
              <p className="track-collect"><Truck size={14} aria-hidden="true" /> Printed and waiting for dispatch</p>
            )}
            {st === "printed" && !isDeliveryOrder && (
              <p className="track-collect"><Store size={14} aria-hidden="true" /> Ready — collect at the counter!</p>
            )}
            {/* Order is only truly "done" once collected (pickup) or actually
                delivered (delivery) — asking for a review before that would
                be asking someone mid-wait, not someone who just got served. */}
            {reviewUrl && st === "printed" && (!isDeliveryOrder || delivered) && (
              <a
                className="btn-secondary result-screen-link result-screen-review"
                href={reviewUrl}
                target="_blank"
                rel="noreferrer"
              >
                <Star size={16} aria-hidden="true" /> Rate us on Google
              </a>
            )}
          </div>
        );
      })()}

      <a className="btn-secondary result-screen-link" href={`/track?token=${result.token}`}>
        <Search size={16} aria-hidden="true" /> Track this order
      </a>
      <button className="btn-secondary result-screen-link" onClick={onReset}>Upload Another</button>
      <div className="thank-you-note">
        <p>Thank you for using Self_Print</p>
        <p className="visit-again">We appreciate your business</p>
      </div>
    </div>
  );
}
