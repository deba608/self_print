import crypto from "node:crypto";
import { normalizePhoneNumber, sendSms } from "./sms";
import { saveOtp, getLatestOtp, incrementOtpAttempts, markOtpVerified, countRecentOtps } from "./db";

const OTP_SECRET_SALT = process.env.OTP_SECRET_SALT || "selfprint-otp-salt-2026";
const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 3;
const COOLDOWN_SECONDS = 60;
const MAX_HOURLY_OTPS = 5;

/**
 * Hashes raw numeric OTP code with SHA-256 and salt.
 */
export function hashOtpCode(code: string): string {
  return crypto
    .createHash("sha256")
    .update(`${code}:${OTP_SECRET_SALT}`)
    .digest("hex");
}

/**
 * Generates a cryptographically secure 6-digit numeric OTP code.
 */
export function generateNumericOtp(): string {
  const num = crypto.randomInt(100000, 1000000);
  return String(num);
}

export type SendOtpOptions = {
  phone: string;
  purpose?: string;
};

export type SendOtpResult = {
  success: boolean;
  cooldownRemaining?: number;
  error?: string;
  devCode?: string; // Included only in dev/console mode for convenience
};

/**
 * Generates, records, and dispatches an OTP to a target phone number.
 */
export async function sendOtpForPhone({ phone, purpose = "login" }: SendOtpOptions): Promise<SendOtpResult> {
  const formattedPhone = normalizePhoneNumber(phone);
  if (!formattedPhone || formattedPhone.length < 10) {
    return { success: false, error: "Please enter a valid phone number." };
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Rate-limiting check 1: Hourly limit
  const oneHourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const recentCount = await countRecentOtps(formattedPhone, oneHourAgoIso);
  if (recentCount >= MAX_HOURLY_OTPS) {
    return {
      success: false,
      error: "Too many OTP requests for this phone number. Please try again in an hour.",
    };
  }

  // Rate-limiting check 2: Cooldown (60s minimum between resends)
  const latestOtp = await getLatestOtp(formattedPhone, purpose);
  if (latestOtp) {
    const elapsedSeconds = (now.getTime() - new Date(latestOtp.createdAt).getTime()) / 1000;
    if (elapsedSeconds < COOLDOWN_SECONDS) {
      const remaining = Math.ceil(COOLDOWN_SECONDS - elapsedSeconds);
      return {
        success: false,
        cooldownRemaining: remaining,
        error: `Please wait ${remaining} second(s) before requesting another OTP.`,
      };
    }
  }

  const code = generateNumericOtp();
  const otpHash = hashOtpCode(code);
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  const otpId = crypto.randomUUID();

  await saveOtp({
    id: otpId,
    phone: formattedPhone,
    otpHash,
    purpose,
    expiresAt,
    createdAt: nowIso,
  });

  const smsText = `Your Selfprint verification code is ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this with anyone.`;
  const smsResult = await sendSms({ to: formattedPhone, message: smsText });

  if (!smsResult.success) {
    return {
      success: false,
      error: smsResult.error || "Failed to dispatch SMS. Please try again.",
    };
  }

  const provider = (process.env.SMS_PROVIDER || "console").toLowerCase();

  return {
    success: true,
    ...(provider === "console" ? { devCode: code } : {}),
  };
}

export type VerifyOtpOptions = {
  phone: string;
  code: string;
  purpose?: string;
};

export type VerifyOtpResult = {
  success: boolean;
  error?: string;
};

/**
 * Validates a submitted OTP code against the latest valid record for that phone & purpose.
 */
export async function verifyOtpCode({ phone, code, purpose = "login" }: VerifyOtpOptions): Promise<VerifyOtpResult> {
  const formattedPhone = normalizePhoneNumber(phone);
  if (!formattedPhone || !code || code.trim().length !== 6) {
    return { success: false, error: "Please enter a valid 6-digit OTP code." };
  }

  const otpRecord = await getLatestOtp(formattedPhone, purpose);
  if (!otpRecord) {
    return { success: false, error: "No active OTP found. Please request a new code." };
  }

  const now = new Date();
  if (now > new Date(otpRecord.expiresAt)) {
    return { success: false, error: "This OTP has expired. Please request a new code." };
  }

  if (otpRecord.attempts >= MAX_ATTEMPTS) {
    return { success: false, error: "Maximum verification attempts exceeded. Please request a new code." };
  }

  const inputHash = hashOtpCode(code.trim());
  if (inputHash !== otpRecord.otpHash) {
    await incrementOtpAttempts(otpRecord.id);
    const remainingAttempts = MAX_ATTEMPTS - (otpRecord.attempts + 1);
    if (remainingAttempts <= 0) {
      return { success: false, error: "Invalid code. Maximum attempts reached. Please request a new OTP." };
    }
    return { success: false, error: `Invalid code. ${remainingAttempts} attempt(s) remaining.` };
  }

  await markOtpVerified(otpRecord.id);
  return { success: true };
}
