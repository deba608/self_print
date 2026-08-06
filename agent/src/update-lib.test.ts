import { describe, it, expect } from "vitest";
import { compareVersions, parseLatestJson, sha256Hex } from "./update-lib";

describe("compareVersions", () => {
  it("orders numerically per segment", () => {
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("parseLatestJson", () => {
  const good = { version: "1.4.0", kind: "code", file: "agent-1.4.0.zip", sha256: "a".repeat(64), publishedAt: "2026-08-06T00:00:00Z" };
  it("accepts a valid document", () => {
    expect(parseLatestJson(JSON.stringify(good)).kind).toBe("code");
  });
  it("rejects bad kind, missing sha256, non-json", () => {
    expect(() => parseLatestJson(JSON.stringify({ ...good, kind: "delta" }))).toThrow();
    expect(() => parseLatestJson(JSON.stringify({ ...good, sha256: "short" }))).toThrow();
    expect(() => parseLatestJson("not json")).toThrow();
  });
  it("ignores unknown extra fields", () => {
    const withExtra = { ...good, deps: { sharp: "0.35.2" }, future: 1 };
    expect(parseLatestJson(JSON.stringify(withExtra)).version).toBe("1.4.0");
  });
});

describe("sha256Hex", () => {
  it("matches known vector", () => {
    expect(sha256Hex(Buffer.from("abc")))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
