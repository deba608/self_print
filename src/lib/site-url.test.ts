import { afterEach, describe, expect, it } from "vitest";
import { getAuthRedirectUrl, getSiteUrl } from "./site-url";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getSiteUrl", () => {
  it("prefers and normalizes the configured site URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://print.example.com/";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ignored.vercel.app";
    expect(getSiteUrl()).toBe("https://print.example.com");
  });

  it("uses Vercel's production host when no site URL is configured", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "selfprint-six.vercel.app";
    expect(getSiteUrl()).toBe("https://selfprint-six.vercel.app");
  });

  it("uses the active Vercel deployment for previews", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.VERCEL_URL = "selfprint-preview.vercel.app";
    expect(getAuthRedirectUrl("reset-password")).toBe(
      "https://selfprint-preview.vercel.app/reset-password"
    );
  });

  it("falls back to localhost outside Vercel", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});
