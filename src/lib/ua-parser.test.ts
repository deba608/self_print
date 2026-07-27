import { describe, expect, it } from "vitest";
import { parseUA } from "./ua-parser";

describe("parseUA", () => {
  it("returns Unknown for null input", () => {
    expect(parseUA(null)).toEqual({ browser: "Unknown", os: "Unknown", device: "Desktop" });
  });

  it("detects Chrome on Windows 10/11", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
    expect(parseUA(ua)).toEqual({ browser: "Chrome 125", os: "Windows 10/11", device: "Desktop" });
  });

  it("detects Edge (not Chrome) on Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
    expect(parseUA(ua)).toEqual({ browser: "Edge 124", os: "Windows 10/11", device: "Desktop" });
  });

  it("detects Firefox on Linux", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0";
    expect(parseUA(ua)).toEqual({ browser: "Firefox 126", os: "Linux", device: "Desktop" });
  });

  it("detects Safari on macOS", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15";
    expect(parseUA(ua)).toEqual({ browser: "Safari 17", os: "macOS 14.4.1", device: "Desktop" });
  });

  it("detects Mobile on Android phone", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
    expect(parseUA(ua)).toEqual({ browser: "Chrome 125", os: "Android 14", device: "Mobile" });
  });

  it("detects Tablet on iPad", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    const result = parseUA(ua);
    expect(result.device).toBe("Tablet");
  });

  it("detects Opera", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0";
    expect(parseUA(ua).browser).toBe("Opera 111");
  });
});
