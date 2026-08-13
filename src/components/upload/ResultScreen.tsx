"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, CreditCard, Loader2, Printer, Search, Smartphone, Star, Store, Truck, UploadCloud, X } from "lucide-react";
import BillReceipt, { type BillData } from "../BillReceipt";
import { loadRazorpayCheckout, type Pricing } from "./shared";
import { calculateSpiralBindingPrice } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/client";

export type JobResult = {
  token: string;
  pricePaise: number;
  deliveryFeePaise?: number;
  addonFeePaise?: number;
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
  customerPhone,
  customerName,
  onReset,
}: {
  result: JobResult;
  pricing: Pricing | null;
  deliveryMethod: "pickup" | "delivery";
  billFiles: { name: string; pages: number }[];
  settings: { printType: string; duplex: string; paperSize: string; copies: number; pagesPerSheet: number; hasSpiralBinding: boolean; hasCoverFile: boolean; hasBondPaper?: boolean; spiralBindingPages?: number; spiralBindingQty?: number; coverFileQty?: number };
  customerPhone?: string;
  customerName?: string;
  onReset: () => void;
}) {
  const [isGuest, setIsGuest] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
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
  // Depend on primitives (not the liveStatus object) so a poll response that
  // changes nothing terminal doesn't tear down and recreate the interval, and
  // fetch once immediately so the timeline isn't stale for the first 5s.
  const liveStatusStatus = liveStatus?.status ?? null;
  const liveDeliveryStatus = liveStatus?.deliveryStatus ?? null;
  useEffect(() => {
    if (result.needsConversion) return;
    if (liveStatusStatus) {
      const terminalFailure = !["pending_payment", "paid", "approved", "printing", "printed"].includes(liveStatusStatus);
      const orderComplete = deliveryMethod === "delivery"
        ? liveStatusStatus === "printed" && liveDeliveryStatus === "delivered"
        : liveStatusStatus === "printed";
      if (terminalFailure || orderComplete) return;
    }
    let cancelled = false;
    async function poll() {
      // Skip background polling while the tab is hidden — the immediate fetch
      // on the next visible tick catches up.
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/jobs/${result.token}/status`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
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
    }
    poll();
    let supabaseChannel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    try {
      const supabase = createClient();
      supabaseChannel = supabase
        .channel(`result-order-${result.token}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "jobs", filter: `token=eq.${result.token}` },
          () => {
            void poll();
          }
        )
        .subscribe();
    } catch {
      // Local dev mode fallback
    }

    const interval = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      if (supabaseChannel) {
        try {
          const supabase = createClient();
          void supabase.removeChannel(supabaseChannel);
        } catch {}
      }
      clearInterval(interval);
    };
  }, [result.token, result.needsConversion, liveStatusStatus, liveDeliveryStatus, deliveryMethod]);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (!data.user) setIsGuest(true);
    });
    setNudgeDismissed(localStorage.getItem("sp_login_nudge_dismissed") === "1");
  }, []);

  const dismissNudge = () => {
    localStorage.setItem("sp_login_nudge_dismissed", "1");
    setNudgeDismissed(true);
  };

  const handleGoogleLogin = () => {
    createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const { printType, duplex, paperSize, copies, pagesPerSheet, hasSpiralBinding, hasCoverFile } = settings;
  const amountRupees = (result.pricePaise / 100).toFixed(2);
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
    settings: {
      printType, duplex, paperSize, copies, pagesPerSheet, hasSpiralBinding, hasCoverFile,
      spiralBindingSlabPaise: hasSpiralBinding && pricing ? calculateSpiralBindingPrice(settings.spiralBindingPages ?? 1, pricing) : undefined,
      spiralBindingQty: settings.spiralBindingQty,
      coverFilePaise: hasCoverFile && pricing ? pricing.coverFilePaise : undefined,
      coverFileQty: settings.coverFileQty,
    },
    totalPaise: result.pricePaise,
    perPagePaise: billPerPage,
    totalPages: result.pageCount || billFiles.reduce((s, f) => s + f.pages, 0),
    deliveryFeePaise: result.deliveryFeePaise ?? 0,
    paidVia: paidInfo?.method ?? "counter",
    paidAt: paidInfo?.at ?? new Date().toISOString(),
  };

  const razorpayKeyId = (pricing?.razorpayKeyId ?? "").trim();
  const showRazorpay = Boolean(razorpayKeyId) && !result.needsConversion && result.pricePaise >= 100;
  // Online payment (Razorpay) is offered as a choice alongside cash for
  // pickup orders. Delivery orders skip the counter entirely, so they must
  // pay online — no cash choice, no counter fallback.
  const isDeliveryOrder = deliveryMethod === "delivery";
  const onlineAvailable = !result.needsConversion && showRazorpay;

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

    // Prefilling contact/email skips the retyping step on Razorpay's own
    // checkout screen — OTP verification still happens there (Razorpay's,
    // not ours), but the customer just confirms it instead of typing a
    // number in fresh.
    const contact = customerPhone && /^\d{10}$/.test(customerPhone) ? `+91${customerPhone}` : undefined;

    const rzp = new (window as any).Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: shopName,
      description: `Token ${result.token}`,
      theme: { color: "#2563eb" },
      prefill: {
        ...(contact && { contact }),
        ...(customerName?.trim() && { name: customerName.trim() }),
      },
      // No `method` restriction: let Razorpay offer every method enabled on
      // the shop's dashboard (UPI, cards, netbanking, wallets, ...) instead
      // of forcing UPI-only.
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
              <div className="mini-track-head-right">
                {st !== "printed" && !failed && (
                  <span className="mini-track-eta">~{Math.max(1, jobsAhead + 1) * 3} min wait</span>
                )}
                <Link className="mini-track-view" href={`/track?token=${result.token}`}>
                  <Search size={13} aria-hidden="true" /> Track
                </Link>
              </div>
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
          </div>
        );
      })()}

      {/* Shown as soon as the order is submitted — not gated on print/delivery
          status. The customer is on this screen for the whole wait anyway,
          so that's exactly when to ask, not after they've already left.
          Its own tinted panel (not just a differently-colored button in the
          same stack) so it reads as a separate, optional favor rather than
          a third peer of Track/Upload Another. */}
      {reviewUrl && (
        <div className="review-prompt">
          <p>Your feedback fuels us.</p>
          <a
            className="result-screen-review"
            href={reviewUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Star size={16} aria-hidden="true" /> Rate us on Google
          </a>
        </div>
      )}

      {isGuest && !nudgeDismissed && (
        <div className="login-nudge">
          <button className="login-nudge-dismiss" onClick={dismissNudge} aria-label="Dismiss">
            <X size={14} />
          </button>
          <p className="login-nudge-title">Save your order history</p>
          <p className="login-nudge-sub">Sign in with Google to track all your orders anytime.</p>
          <button type="button" className="login-nudge-btn" onClick={handleGoogleLogin}>
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.61z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.36 0-4.36-1.6-5.08-3.75H.9v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.92 10.67A5.4 5.4 0 0 1 3.64 9c0-.58.1-1.15.28-1.67V5H.9a9 9 0 0 0 0 8l3.02-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .9 5l3.02 2.33C4.64 5.18 6.64 3.58 9 3.58z" />
            </svg>
            Continue with Google
          </button>
        </div>
      )}

      <button className="btn-secondary result-screen-link" onClick={onReset}>Upload Another</button>
      <div className="thank-you-note">
        <p>Thank you for using Self_Print</p>
        <p className="visit-again">We appreciate your business</p>
      </div>
    </div>
  );
}
