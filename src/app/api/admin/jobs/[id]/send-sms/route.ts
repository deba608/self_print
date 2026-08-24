import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { getJobById } from "@/lib/db";
import { sendSms } from "@/lib/sms";
import {
  sendJobApprovedSms,
  sendOutForDeliverySms,
  sendDeliveredSms,
  sendPaymentReceivedSms,
} from "@/lib/sms-notifications";
import {
  sendJobApprovedWa,
  sendOutForDeliveryWa,
  sendDeliveredWa,
  sendPaymentReceivedWa,
} from "@/lib/whatsapp-notifications";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff) {
    return NextResponse.json({ error: "Staff login required" }, { status: 401 });
  }

  const { id } = await params;
  const job = await getJobById(id);

  if (!job) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (!job.customerPhone) {
    return NextResponse.json({ error: "No customer phone number attached to this order" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const type = body?.type || "custom";
  const customMessage = body?.message;

  // Lowest-privilege role guard: delivery riders may send the fixed order
  // templates for their workflow, but arbitrary custom text to any customer
  // phone is an admin-only capability (phishing / SMS-cost abuse otherwise).
  const TEMPLATE_TYPES = new Set(["approved", "out_for_delivery", "delivered", "payment"]);
  if (!TEMPLATE_TYPES.has(type) && staff.role === "delivery") {
    return NextResponse.json({ error: "Custom messages require an admin account" }, { status: 403 });
  }

  try {
    const input = { phone: job.customerPhone, token: job.token };
    let result;
    if (type === "approved") {
      const [wa, sms] = await Promise.allSettled([
        sendJobApprovedWa(input),
        sendJobApprovedSms(input),
      ]);
      result = wa.status === "fulfilled" ? wa.value : sms.status === "fulfilled" ? sms.value : null;
    } else if (type === "out_for_delivery") {
      const delivery = { ...input, driverName: staff.displayName || "Delivery Executive" };
      const [wa, sms] = await Promise.allSettled([
        sendOutForDeliveryWa(delivery),
        sendOutForDeliverySms(delivery),
      ]);
      result = wa.status === "fulfilled" ? wa.value : sms.status === "fulfilled" ? sms.value : null;
    } else if (type === "delivered") {
      const [wa, sms] = await Promise.allSettled([
        sendDeliveredWa(input),
        sendDeliveredSms(input),
      ]);
      result = wa.status === "fulfilled" ? wa.value : sms.status === "fulfilled" ? sms.value : null;
    } else if (type === "payment") {
      const payment = { ...input, amountPaise: job.pricePaise };
      const [wa, sms] = await Promise.allSettled([
        sendPaymentReceivedWa(payment),
        sendPaymentReceivedSms(payment),
      ]);
      result = wa.status === "fulfilled" ? wa.value : sms.status === "fulfilled" ? sms.value : null;
    } else {
      const message = customMessage ? String(customMessage).trim() : `Selfprint update for order #${job.token}: Status is ${job.status}.`;
      result = await sendSms({ to: job.customerPhone, message });
    }

    if (!result?.success) {
      return NextResponse.json({ error: result?.error || "SMS dispatch failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, provider: result.provider, messageId: result.messageId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send SMS" },
      { status: 500 }
    );
  }
}
