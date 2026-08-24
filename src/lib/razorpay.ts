import crypto from "node:crypto";
import Razorpay from "razorpay";

// Razorpay Standard Checkout helpers. The key secret and webhook secret stay
// server-side only; the key id is publishable and safe to send to the browser.

export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

/** True when both keys are present, i.e. Razorpay payments are enabled. */
export function isRazorpayConfigured(): boolean {
  return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
}

let client: Razorpay | null = null;

/** Lazily builds a shared Razorpay client. Throws if keys are missing. */
export function razorpay(): Razorpay {
  if (!isRazorpayConfigured()) {
    throw new Error("Razorpay is not configured (missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).");
  }
  if (!client) {
    client = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
  }
  return client;
}

/**
 * Verifies a Standard Checkout success payload.
 * signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret).
 * Uses a timing-safe compare.
 */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!orderId || !paymentId || !signature || !RAZORPAY_KEY_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return timingSafeEqualHex(expected, signature);
}

/**
 * Verifies a webhook payload: HMAC_SHA256(rawBody, webhook_secret) == header.
 * Returns false when no webhook secret is configured.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = crypto
    .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return timingSafeEqualHex(expected, signature);
}

/** Issues a full refund for a captured payment. Amount is in paise. */
export async function refundPayment(paymentId: string, amountPaise: number) {
  return razorpay().payments.refund(paymentId, { amount: Math.round(amountPaise) });
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
