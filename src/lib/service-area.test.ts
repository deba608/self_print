import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_AREA, checkDeliveryServiceable, haversineKm, isValidPincode,
  parseServiceAreaConfig, pointInPolygon, serializeServiceAreaConfig, validateServiceAreaConfig,
} from "./service-area";
import type { ServiceAreaConfig } from "./service-area";

const base = (over: Partial<ServiceAreaConfig>): ServiceAreaConfig => ({ ...DEFAULT_SERVICE_AREA, ...over });
const input = (over: Partial<Parameters<typeof checkDeliveryServiceable>[0]>) => ({
  pincode: null, area: null, lat: null, lng: null, ...over,
});

describe("isValidPincode", () => {
  it("accepts 6 digits not starting with 0", () => expect(isValidPincode("713347")).toBe(true));
  it.each(["013347", "71334", "7133471", "71334a", ""])("rejects %j", (v) =>
    expect(isValidPincode(v)).toBe(false));
});

describe("parseServiceAreaConfig", () => {
  it("returns mode off for null/empty/malformed", () => {
    expect(parseServiceAreaConfig(null).mode).toBe("off");
    expect(parseServiceAreaConfig("").mode).toBe("off");
    expect(parseServiceAreaConfig("{not json").mode).toBe("off");
  });
  it("round-trips through serialize", () => {
    const cfg = base({ mode: "pincode", pincodes: [{ pincode: "713347", areas: ["Sitarampur"] }] });
    expect(parseServiceAreaConfig(serializeServiceAreaConfig(cfg))).toEqual(cfg);
  });
  it("drops invalid pincodes and unknown modes", () => {
    const parsed = parseServiceAreaConfig(JSON.stringify({
      mode: "banana", pincodes: [{ pincode: "0999", areas: [] }, { pincode: "713347", areas: [] }],
    }));
    expect(parsed.mode).toBe("off");
    expect(parsed.pincodes).toEqual([{ pincode: "713347", areas: [] }]);
  });
});

describe("validateServiceAreaConfig", () => {
  it("rejects a non-object", () => {
    expect(validateServiceAreaConfig("x")).toHaveProperty("error");
  });
  it("rejects bad radius", () => {
    expect(validateServiceAreaConfig({ ...DEFAULT_SERVICE_AREA, radiusKm: -1 })).toHaveProperty("error");
  });
  it("accepts a full valid config", () => {
    const cfg = base({ mode: "radius", radiusKm: 5, shopLat: 23.68, shopLng: 86.98 });
    expect(validateServiceAreaConfig(cfg)).toEqual({ config: cfg });
  });
});

describe("haversineKm", () => {
  it("is ~0 for identical points", () => expect(haversineKm(23.68, 86.98, 23.68, 86.98)).toBeCloseTo(0, 5));
  it("computes a known distance (~1 deg lat ≈ 111 km)", () =>
    expect(haversineKm(23, 86.98, 24, 86.98)).toBeGreaterThan(110));
});

describe("pointInPolygon", () => {
  const tri: Array<[number, number]> = [[0, 0], [0, 10], [10, 0]];
  it("inside", () => expect(pointInPolygon(2, 2, tri)).toBe(true));
  it("outside", () => expect(pointInPolygon(8, 8, tri)).toBe(false));
});

describe("checkDeliveryServiceable", () => {
  it("mode off allows anything", () =>
    expect(checkDeliveryServiceable(input({}), DEFAULT_SERVICE_AREA)).toEqual({ ok: true }));

  it("pincode mode: listed ok, unlisted rejected, empty list fails open", () => {
    const cfg = base({ mode: "pincode", pincodes: [{ pincode: "713347", areas: [] }] });
    expect(checkDeliveryServiceable(input({ pincode: "713347" }), cfg)).toEqual({ ok: true });
    expect(checkDeliveryServiceable(input({ pincode: "560001" }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({ pincode: "560001" }), base({ mode: "pincode" }))).toEqual({ ok: true });
  });

  it("pincode_area mode: area required only when pincode defines areas; case-insensitive match", () => {
    const cfg = base({ mode: "pincode_area", pincodes: [
      { pincode: "713347", areas: ["Sitarampur"] },
      { pincode: "713343", areas: [] },
    ]});
    expect(checkDeliveryServiceable(input({ pincode: "713347", area: "sitarampur" }), cfg)).toEqual({ ok: true });
    expect(checkDeliveryServiceable(input({ pincode: "713347", area: "Elsewhere" }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({ pincode: "713347", area: null }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({ pincode: "713343", area: null }), cfg)).toEqual({ ok: true });
  });

  it("radius mode: inside ok, outside rejected, missing GPS rejected, no shop coords fails open", () => {
    const cfg = base({ mode: "radius", radiusKm: 5, shopLat: 23.68, shopLng: 86.98 });
    expect(checkDeliveryServiceable(input({ lat: 23.681, lng: 86.981 }), cfg)).toEqual({ ok: true });
    expect(checkDeliveryServiceable(input({ lat: 24.5, lng: 86.98 }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({}), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({}), base({ mode: "radius" }))).toEqual({ ok: true });
  });

  it("polygon mode: inside ok, outside rejected, missing GPS rejected, <3 vertices fails open", () => {
    const cfg = base({ mode: "polygon", polygon: [[23.6, 86.9], [23.6, 87.1], [23.8, 87.0]] });
    expect(checkDeliveryServiceable(input({ lat: 23.65, lng: 86.99 }), cfg)).toEqual({ ok: true });
    expect(checkDeliveryServiceable(input({ lat: 25, lng: 90 }), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({}), cfg).ok).toBe(false);
    expect(checkDeliveryServiceable(input({}), base({ mode: "polygon", polygon: [[0, 0]] }))).toEqual({ ok: true });
  });
});
