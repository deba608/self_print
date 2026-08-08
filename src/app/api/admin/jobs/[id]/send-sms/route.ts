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

  try {
    let result;
    if (type === "approved") {
      result = await sendJobApprovedSms({ phone: job.customerPhone, token: job.token });
    } else if (type === "out_for_delivery") {
      result = await sendOutForDeliverySms({
        phone: job.customerPhone,
        token: job.token,
        driverName: staff.displayName || "Delivery Executive",
      });
    } else if (type === "delivered") {
      result = await sendDeliveredSms({ phone: job.customerPhone, token: job.token });
    } else if (type === "payment") {
      result = await sendPaymentReceivedSms({
        phone: job.customerPhone,
        token: job.token,
        amountPaise: job.pricePaise,
      });
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
