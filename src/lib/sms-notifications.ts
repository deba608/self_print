import { normalizePhoneNumber, sendSms } from "./sms";

export type JobNotificationInput = {
  phone: string | null;
  token: string;
  queuePosition?: number;
  driverName?: string | null;
  driverPhone?: string | null;
  amountPaise?: number;
};

/**
 * Sends order creation / confirmation SMS.
 */
export async function sendJobCreatedSms({ phone, token, queuePosition }: JobNotificationInput) {
  if (!phone) return null;
  const formatted = normalizePhoneNumber(phone);
  if (!formatted) return null;

  const queueText = queuePosition != null ? ` Queue position: #${queuePosition}.` : "";
  const message = `Selfprint: Order #${token} has been received.${queueText} Thank you for your order!`;
  return sendSms({ to: formatted, message });
}

/**
 * Sends SMS when print job is approved / ready for pickup.
 */
export async function sendJobApprovedSms({ phone, token }: JobNotificationInput) {
  if (!phone) return null;
  const formatted = normalizePhoneNumber(phone);
  if (!formatted) return null;

  const message = `Selfprint: Order #${token} has been approved and is ready at the shop! Thank you.`;
  return sendSms({ to: formatted, message });
}

/**
 * Sends SMS when order delivery status moves to out_for_delivery.
 */
export async function sendOutForDeliverySms({ phone, token, driverName, driverPhone }: JobNotificationInput) {
  if (!phone) return null;
  const formatted = normalizePhoneNumber(phone);
  if (!formatted) return null;

  const driverText = driverName ? ` with ${driverName}${driverPhone ? ` (${driverPhone})` : ""}` : "";
  const message = `Selfprint: Order #${token} is out for delivery${driverText}! Please be available at your delivery location.`;
  return sendSms({ to: formatted, message });
}

/**
 * Sends SMS when order delivery status moves to delivered.
 */
export async function sendDeliveredSms({ phone, token }: JobNotificationInput) {
  if (!phone) return null;
  const formatted = normalizePhoneNumber(phone);
  if (!formatted) return null;

  const message = `Selfprint: Order #${token} has been successfully delivered. Thank you for choosing Selfprint!`;
  return sendSms({ to: formatted, message });
}

/**
 * Sends payment confirmation SMS.
 */
export async function sendPaymentReceivedSms({ phone, token, amountPaise }: JobNotificationInput) {
  if (!phone) return null;
  const formatted = normalizePhoneNumber(phone);
  if (!formatted) return null;

  const amountText = amountPaise != null ? ` of ₹${(amountPaise / 100).toFixed(2)}` : "";
  const message = `Selfprint: Payment${amountText} received for Order #${token}. Thank you!`;
  return sendSms({ to: formatted, message });
}
