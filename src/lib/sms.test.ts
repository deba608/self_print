import { describe, it, expect } from "vitest";
import { normalizePhoneNumber, sendSms } from "./sms";
import { hashOtpCode, generateNumericOtp } from "./otp";

describe("normalizePhoneNumber", () => {
  it("formats 10-digit Indian numbers with +91 country code", () => {
    expect(normalizePhoneNumber("9876543210")).toBe("+919876543210");
    expect(normalizePhoneNumber("987-654-3210")).toBe("+919876543210");
  });

  it("preserves pre-formatted E.164 international numbers", () => {
    expect(normalizePhoneNumber("+919876543210")).toBe("+919876543210");
    expect(normalizePhoneNumber("+14155552671")).toBe("+14155552671");
  });

  it("returns empty string for invalid inputs", () => {
    expect(normalizePhoneNumber("")).toBe("");
    expect(normalizePhoneNumber("abc")).toBe("");
  });
});

describe("OTP generation and hashing", () => {
  it("generates a 6-digit numeric string", () => {
    const otp = generateNumericOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("consistently hashes OTP codes with salt", () => {
    const hash1 = hashOtpCode("123456");
    const hash2 = hashOtpCode("123456");
    const hashDiff = hashOtpCode("654321");

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hashDiff);
    expect(hash1.length).toBe(64); // SHA-256 hex length
  });
});

describe("sendSms (console mode)", () => {
  it("successfully dispatches in console/dev mode", async () => {
    const result = await sendSms({ to: "9876543210", message: "Test verification message" });
    expect(result.success).toBe(true);
    expect(result.provider).toBe("console");
    expect(result.messageId).toContain("console-");
  });
});
