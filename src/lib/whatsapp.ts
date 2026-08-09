/**
 * WhatsApp Cloud API sender (Meta Graph API v21.0).
 * No-op when env vars are missing — local dev keeps working without WhatsApp configured.
 * Fire-and-forget: errors are logged but never thrown to callers.
 */

export type WaSendResult = {
  success: boolean;
  messageId?: string;
  provider: "whatsapp";
  error?: string;
};

type TemplateComponent = {
  type: "body" | "header" | "button";
  sub_type?: string;
  index?: number;
  parameters: Array<{ type: "text"; text: string }>;
};

/** Normalise to E.164 without '+'. WhatsApp expects '918117050246' not '+918117050246'. */
export function normalizeWaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/**
 * Send a pre-approved WhatsApp template message.
 * @param to        Raw phone string (10-digit or E.164)
 * @param template  Approved template name (e.g. "otp_login")
 * @param variables Ordered positional variables matching {{1}}, {{2}}, ... in the template body
 * @param lang      BCP-47 language code (default "en")
 */
export async function sendWhatsAppTemplate(
  to: string,
  template: string,
  variables: string[],
  lang = "en"
): Promise<WaSendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  // Silent no-op in dev when not configured
  if (!phoneNumberId || !accessToken) {
    console.log(`[WhatsApp no-op] template=${template} to=${to} vars=${variables.join("|")}`);
    return { success: true, messageId: `noop-${Date.now()}`, provider: "whatsapp" };
  }

  const waPhone = normalizeWaPhone(to);
  if (!waPhone || waPhone.length < 10) {
    return { success: false, error: "Invalid phone number", provider: "whatsapp" };
  }

  const bodyComponents: TemplateComponent[] = variables.length
    ? [
        {
          type: "body",
          parameters: variables.map((v) => ({ type: "text", text: v })),
        },
      ]
    : [];

  const payload = {
    messaging_product: "whatsapp",
    to: waPhone,
    type: "template",
    template: {
      name: template,
      language: { code: lang },
      components: bodyComponents,
    },
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg =
        data?.error?.message || data?.error?.error_data?.details || `HTTP ${res.status}`;
      console.error(`[WhatsApp] Failed to send template=${template} to=${waPhone}: ${errMsg}`);
      return { success: false, error: errMsg, provider: "whatsapp" };
    }

    const messageId = data?.messages?.[0]?.id;
    return { success: true, messageId, provider: "whatsapp" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "WhatsApp send failed";
    console.error(`[WhatsApp] Exception sending template=${template} to=${waPhone}:`, msg);
    return { success: false, error: msg, provider: "whatsapp" };
  }
}
