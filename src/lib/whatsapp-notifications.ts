import { normalizeWaPhone, sendWhatsAppTemplate } from "./whatsapp";

export type WaNotificationInput = {
  phone: string | null;
  token: string;
  queuePosition?: number;
  driverName?: string | null;
  driverPhone?: string | null;
  amountPaise?: number;
};

/** OTP login — Authentication template (Meta enforces fixed format). */
export async function sendOtpWhatsApp(phone: string, code: string) {
  const wa = normalizeWaPhone(phone);
  if (!wa) return null;
  return sendWhatsAppTemplate(wa, "otp_login", [code]);
}

/** Order received after upload. */
export async function sendJobCreatedWa({ phone, token, queuePosition }: WaNotificationInput) {
  if (!phone) return null;
  const queueText = queuePosition != null ? `#${queuePosition}` : "—";
  // template: "Your SelfPrint order *{{1}}* is received. Queue position: {{2}}. Thank you!"
  return sendWhatsAppTemplate(phone, "order_created", [token, queueText]);
}

/** Job approved / ready for counter pickup. */
export async function sendJobApprovedWa({ phone, token }: WaNotificationInput) {
  if (!phone) return null;
  // template: "Order *{{1}}* is printed and ready. Show this token at the counter."
  return sendWhatsAppTemplate(phone, "order_ready", [token]);
}

/** Delivery status moved to out_for_delivery. */
export async function sendOutForDeliveryWa({
  phone,
  token,
  driverName,
  driverPhone,
}: WaNotificationInput) {
  if (!phone) return null;
  const name = driverName || "Delivery Executive";
  const contact = driverPhone || "—";
  // template: "Order *{{1}}* is out for delivery with {{2}} ({{3}}). It will reach you soon."
  return sendWhatsAppTemplate(phone, "out_for_delivery", [token, name, contact]);
}

/** Delivery status moved to delivered. */
export async function sendDeliveredWa({ phone, token }: WaNotificationInput) {
  if (!phone) return null;
  // template: "Order *{{1}}* delivered. Loved the service? Rate us: {{2}}"
  const reviewLink = process.env.SHOP_REVIEW_URL || "selfprint.in";
  return sendWhatsAppTemplate(phone, "order_delivered", [token, reviewLink]);
}

/** Payment received confirmation. */
export async function sendPaymentReceivedWa({ phone, token, amountPaise }: WaNotificationInput) {
  if (!phone) return null;
  const amount = amountPaise != null ? `₹${(amountPaise / 100).toFixed(2)}` : "";
  // template: "Payment of {{1}} received for order *{{2}}*. Thank you!"
  return sendWhatsAppTemplate(phone, "payment_received", [amount, token]);
}
