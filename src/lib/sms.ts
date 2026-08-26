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

export function normalizePhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (phone.startsWith("+")) return `+${digits}`;
  return `+${digits}`;
}

/** SMS dispatcher. Only 'console' provider active — configure an SMS gateway for real notifications. */
export async function sendSms({ to, message }: SendSmsOptions): Promise<SendSmsResult> {
  const formattedPhone = normalizePhoneNumber(to);
  if (!formattedPhone || formattedPhone.length < 10) {
    return { success: false, provider: "console", error: "Invalid target phone number format" };
  }

  console.log("\n=================== [ SMS DISPATCH (DEV CONSOLE) ] ===================");
  console.log(`To:      ${formattedPhone}`);
  console.log(`Time:    ${new Date().toISOString()}`);
  console.log(`Content: ${message}`);
  console.log("======================================================================\n");

  return { success: true, messageId: `console-${Date.now()}`, provider: "console" };
}
