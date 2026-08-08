export type SendSmsOptions = {
  to: string;
  message: string;
};

export type SendSmsResult = {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
};

/**
 * Cleanly formats a phone number to standard E.164 format.
 * Defaults to Indian standard country code (+91) if a 10-digit number is provided.
 */
export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (phone.startsWith("+")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/**
 * Dispatches an SMS using the configured SMS provider.
 * Default provider is 'console' for safe, zero-config local testing.
 */
export async function sendSms({ to, message }: SendSmsOptions): Promise<SendSmsResult> {
  const formattedPhone = normalizePhoneNumber(to);
  if (!formattedPhone || formattedPhone.length < 10) {
    return {
      success: false,
      provider: process.env.SMS_PROVIDER || "console",
      error: "Invalid target phone number format",
    };
  }

  const provider = (process.env.SMS_PROVIDER || "console").toLowerCase();

  try {
    switch (provider) {
      case "twilio":
        return await sendTwilioSms(formattedPhone, message);
      case "fast2sms":
        return await sendFast2Sms(formattedPhone, message);
      case "msg91":
        return await sendMsg91Sms(formattedPhone, message);
      case "console":
      default:
        return sendConsoleSms(formattedPhone, message);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "SMS dispatch failure";
    console.error(`[SMS Error] Failed to send SMS to ${formattedPhone} via ${provider}:`, errorMsg);
    return {
      success: false,
      provider,
      error: errorMsg,
    };
  }
}

function sendConsoleSms(to: string, message: string): SendSmsResult {
  console.log("\n=================== [ SMS DISPATCH (DEV CONSOLE) ] ===================");
  console.log(`To:      ${to}`);
  console.log(`Time:    ${new Date().toISOString()}`);
  console.log(`Content: ${message}`);
  console.log("======================================================================\n");

  return {
    success: true,
    messageId: `console-${Date.now()}`,
    provider: "console",
  };
}

async function sendTwilioSms(to: string, message: string): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Missing Twilio configuration (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)");
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const bodyParams = new URLSearchParams({
    To: to,
    From: fromNumber,
    Body: message,
  });

  const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: authHeader,
    },
    body: bodyParams.toString(),
  });

  const resData = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(resData.message || `Twilio HTTP error ${response.status}`);
  }

  return {
    success: true,
    messageId: resData.sid,
    provider: "twilio",
  };
}

async function sendFast2Sms(to: string, message: string): Promise<SendSmsResult> {
  const apiKey = process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    throw new Error("Missing Fast2SMS configuration (FAST2SMS_API_KEY)");
  }

  // Fast2SMS requires 10-digit phone number for India
  const numbers = to.replace(/\D/g, "").slice(-10);

  const response = await fetch("https://www.fast2sms.com/dev/bulkV2", {
    method: "POST",
    headers: {
      authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      route: "v3",
      sender_id: process.env.FAST2SMS_SENDER_ID || "TXTIND",
      message: message,
      language: "english",
      flash: 0,
      numbers: numbers,
    }),
  });

  const resData = await response.json().catch(() => ({}));

  if (!response.ok || !resData.return) {
    throw new Error(resData.message?.[0] || resData.message || `Fast2SMS error ${response.status}`);
  }

  return {
    success: true,
    messageId: resData.request_id || `fast2sms-${Date.now()}`,
    provider: "fast2sms",
  };
}

async function sendMsg91Sms(to: string, message: string): Promise<SendSmsResult> {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;

  if (!authKey) {
    throw new Error("Missing MSG91 configuration (MSG91_AUTH_KEY)");
  }

  const phone = to.replace(/\D/g, "");

  const response = await fetch("https://control.msg91.com/api/v5/flow/", {
    method: "POST",
    headers: {
      authkey: authKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      short_url: "0",
      recipients: [
        {
          mobiles: phone,
          message: message,
        },
      ],
    }),
  });

  const resData = await response.json().catch(() => ({}));

  if (!response.ok || resData.type === "error") {
    throw new Error(resData.message || `MSG91 error ${response.status}`);
  }

  return {
    success: true,
    messageId: resData.request_id || `msg91-${Date.now()}`,
    provider: "msg91",
  };
}
