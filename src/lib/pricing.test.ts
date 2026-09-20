import { describe, it, expect } from "vitest";
import { activeForcedOpen, activePause, billableSides, calculatePrice, calculateSpiralBindingPrice, duplexRateSplit, effectiveDeliveryFeePaise, effectiveFileSettings, isAcceptingOrders, isDeliveryAvailable, pauseReason } from "./pricing";
import type { PricingConfig } from "./types";
import { DEFAULT_SERVICE_AREA } from "./service-area";

const pricing: PricingConfig = {
  bwPerPagePaise: 200,
  colorPerPagePaise: 500,
  photoPrintPaise: 1000,
  copyMultiplier: 1,
  a3Multiplier: 1,
  a4Multiplier: 1,
  a5Multiplier: 1,
  a6Multiplier: 1,
  b5Multiplier: 1,
  legalMultiplier: 1,
  photoMultiplier: 1,
  duplexBwPerPagePaise: 300,
  spiralBindingPerPagePaise: 150,
  coverFilePaise: 1000,
  bondPaperPerPagePaise: 100,
  spiralBindingSlab1Paise: 2000,
  spiralBindingSlab2Paise: 2500,
  spiralBindingSlab3Paise: 3000,
  spiralBindingSlab4Paise: 4000,
  spiralBindingSlab5Paise: 5000,
  expiryMinutes: 30,
  deliveryFeePaise: 0,
  freeDeliveryThresholdPaise: 20000,
  serviceArea: DEFAULT_SERVICE_AREA,
  acceptingOrders: true,
  orderOpenTime: null,
  orderCloseTime: null,
  orderOpenTime2: null,
  orderCloseTime2: null,
  orderDays: null,
  deliveryOpenTime: null,
  deliveryCloseTime: null,
  deliveryDays: null,
  pausedUntil: null,
  pauseNote: null,
  forcedOpenUntil: null,
};

describe("calculatePrice pagesPerSheet", () => {
  it("bills per physical side, not per document page, when pagesPerSheet > 1", () => {
    // 8-page doc, 4-up, simplex -> 2 physical sides -> 2 * bwPerPagePaise
    const price = calculatePrice({
      printType: "bw",
      copies: 1,
      pageRange: null,
      paperSize: "A4",
      pageCount: 8,
      pricing,
      duplex: "simplex",
      pagesPerSheet: 4,
    });
    expect(price).toBe(2 * pricing.bwPerPagePaise);
  });

  it("defaults to 1-up (unchanged behavior) when pagesPerSheet is omitted", () => {
    const price = calculatePrice({
      printType: "bw",
      copies: 1,
      pageRange: null,
      paperSize: "A4",
      pageCount: 8,
      pricing,
      duplex: "simplex",
    });
    expect(price).toBe(8 * pricing.bwPerPagePaise);
  });

  it("combines pagesPerSheet with duplex: sides are paired at the duplex rate", () => {
    // 8 pages, 2-up -> 4 sides, all duplex-paired -> each side billed at the
    // duplex rate (same "per side" convention as the non-N-up path).
    const price = calculatePrice({
      printType: "bw",
      copies: 1,
      pageRange: null,
      paperSize: "A4",
      pageCount: 8,
      pricing,
      duplex: "long-edge",
      pagesPerSheet: 2,
    });
    expect(price).toBe(4 * pricing.duplexBwPerPagePaise);
  });

  it("rounds up a partial sheet (odd remainder)", () => {
    // 9 pages, 4-up -> ceil(9/4) = 3 sides
    const price = calculatePrice({
      printType: "bw",
      copies: 1,
      pageRange: null,
      paperSize: "A4",
      pageCount: 9,
      pricing,
      duplex: "simplex",
      pagesPerSheet: 4,
    });
    expect(price).toBe(3 * pricing.bwPerPagePaise);
  });
});

describe("calculateSpiralBindingPrice slabs", () => {
  it("charges the correct slab for each page range", () => {
    expect(calculateSpiralBindingPrice(1, pricing)).toBe(2000);   // 0-70
    expect(calculateSpiralBindingPrice(70, pricing)).toBe(2000);  // 0-70
    expect(calculateSpiralBindingPrice(71, pricing)).toBe(2500);  // 71-100
    expect(calculateSpiralBindingPrice(100, pricing)).toBe(2500); // 71-100
    expect(calculateSpiralBindingPrice(101, pricing)).toBe(3000); // 101-150
    expect(calculateSpiralBindingPrice(150, pricing)).toBe(3000); // 101-150
    expect(calculateSpiralBindingPrice(151, pricing)).toBe(4000); // 151-200
    expect(calculateSpiralBindingPrice(200, pricing)).toBe(4000); // 151-200
    expect(calculateSpiralBindingPrice(201, pricing)).toBe(5000); // >200
  });
});

describe("effectiveDeliveryFeePaise free-delivery threshold", () => {
  const feePaise = 4000; // ₹40 flat delivery fee
  const threshold = 20000; // ₹200

  it("charges the fee below the threshold", () => {
    expect(effectiveDeliveryFeePaise(threshold - 1, feePaise, threshold)).toBe(feePaise);
  });

  it("waives the fee exactly at the threshold", () => {
    expect(effectiveDeliveryFeePaise(threshold, feePaise, threshold)).toBe(0);
  });

  it("waives the fee above the threshold", () => {
    expect(effectiveDeliveryFeePaise(threshold + 500, feePaise, threshold)).toBe(0);
  });

  it("stays 0 when there was no delivery fee to begin with", () => {
    expect(effectiveDeliveryFeePaise(0, 0, threshold)).toBe(0);
  });

  it("always charges the fee when the threshold is disabled (0)", () => {
    expect(effectiveDeliveryFeePaise(1_000_000, feePaise, 0)).toBe(feePaise);
  });
});

describe("effectiveFileSettings (bulk per-file customization)", () => {
  const jobDefaults = { printType: "bw", duplex: "simplex", paperSize: "A4", layout: "portrait", copies: 1, pagesPerSheet: 1 } as const;

  it("inherits every job default when there is no override", () => {
    expect(effectiveFileSettings(jobDefaults, null)).toEqual(jobDefaults);
    expect(effectiveFileSettings(jobDefaults, undefined)).toEqual(jobDefaults);
  });

  it("applies only the overridden fields, inheriting the rest", () => {
    expect(effectiveFileSettings(jobDefaults, { printType: "color" })).toEqual({
      ...jobDefaults,
      printType: "color",
    });
  });

  it("applies every field when all are overridden", () => {
    const override = { printType: "color", duplex: "long-edge", paperSize: "A3", layout: "landscape", copies: 3, pagesPerSheet: 2 } as const;
    expect(effectiveFileSettings(jobDefaults, override)).toEqual(override);
  });

  it("an empty override object still falls back to job defaults field by field", () => {
    expect(effectiveFileSettings(jobDefaults, {})).toEqual(jobDefaults);
  });
});

describe("duplexRateSplit (receipt rate line)", () => {
  it("returns null for simplex, color, or even sides", () => {
    expect(duplexRateSplit({ duplex: "simplex", printType: "bw", sides: 7, pricing })).toBeNull();
    expect(duplexRateSplit({ duplex: "long-edge", printType: "color", sides: 7, pricing })).toBeNull();
    expect(duplexRateSplit({ duplex: "long-edge", printType: "bw", sides: 8, pricing })).toBeNull();
  });

  it("splits an odd-side B&W duplex job into paired + trailing rates", () => {
    // bw 200 / duplex 300 (test fixture): 7 sides -> 6 at 300 + 1 at 200,
    // matching calculatePrice's pairing.
    expect(duplexRateSplit({ duplex: "long-edge", printType: "bw", sides: 7, pricing })).toEqual({
      pairedSides: 6,
      pairedPaise: 300,
      trailingSides: 1,
      trailingPaise: 200,
    });
  });

  it("returns null when the duplex rate equals the simplex rate (no visible split)", () => {
    const sameRate = { ...pricing, duplexBwPerPagePaise: pricing.bwPerPagePaise };
    expect(duplexRateSplit({ duplex: "long-edge", printType: "bw", sides: 7, pricing: sameRate })).toBeNull();
  });

  it("uses billable sides (N-up aware) for the split input", () => {    // 8 doc pages at 2-up -> 4 sides (even) -> no split.
    expect(billableSides(8, null, 2)).toBe(4);
    expect(duplexRateSplit({ duplex: "long-edge", printType: "bw", sides: billableSides(8, null, 2), pricing })).toBeNull();
    // 9 doc pages at 4-up -> ceil(9/4) = 3 sides (odd) -> split 2+1.
    expect(billableSides(9, null, 4)).toBe(3);
    expect(duplexRateSplit({ duplex: "long-edge", printType: "bw", sides: billableSides(9, null, 4), pricing })).toEqual({
      pairedSides: 2,
      pairedPaise: 300,
      trailingSides: 1,
      trailingPaise: 200,
    });
  });
});

describe("temporary shop pause", () => {
  const futureIso = new Date(Date.now() + 3600000).toISOString();
  const pastIso = new Date(Date.now() - 60000).toISOString();

  it("activePause returns the pause while pausedUntil is in the future", () => {
    const pause = activePause({ ...pricing, pausedUntil: futureIso, pauseNote: "  Out for lunch  " });
    expect(pause).not.toBeNull();
    expect(pause!.note).toBe("Out for lunch");
  });

  it("activePause ignores missing, expired, and malformed timestamps", () => {
    expect(activePause(pricing)).toBeNull();
    expect(activePause({ ...pricing, pausedUntil: pastIso })).toBeNull();
    expect(activePause({ ...pricing, pausedUntil: "not-a-date" })).toBeNull();
  });

  it("isAcceptingOrders blocks pickup during a pause, with the staff note", () => {
    const res = isAcceptingOrders({ ...pricing, pausedUntil: futureIso, pauseNote: "Back soon" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("short break");
      expect(res.reason).toContain("Back soon");
    }
  });

  it("isAcceptingOrders reopens on its own once the pause expires", () => {
    expect(isAcceptingOrders({ ...pricing, pausedUntil: pastIso })).toEqual({ ok: true });
  });

  it("isDeliveryAvailable is also paused (one action pauses both)", () => {
    const res = isDeliveryAvailable({ ...pricing, pausedUntil: futureIso, pauseNote: null });
    expect(res.ok).toBe(false);
  });

  it("pauseReason labels today/tomorrow reopenings", () => {
    const inAnHour = new Date(Date.now() + 3600000);
    expect(pauseReason(inAnHour, null)).toContain("today at");
    const tomorrow = new Date(Date.now() + 26 * 3600000);
    expect(pauseReason(tomorrow, null)).toContain("tomorrow at");
  });
});

describe("temporary forced open", () => {
  const futureIso = new Date(Date.now() + 3600000).toISOString();
  const pastIso = new Date(Date.now() - 60000).toISOString();

  // A schedule that is deterministically closed right now: open almost all
  // day, but only on a weekday that is not today (shop-local).
  function scheduleClosed() {
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date());
    const todayIso = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekday] ?? 1;
    const otherDay = (todayIso % 7) + 1;
    return { ...pricing, orderOpenTime: "00:00", orderCloseTime: "23:59", orderDays: String(otherDay) };
  }

  it("activeForcedOpen ignores missing, expired, and malformed timestamps", () => {
    expect(activeForcedOpen(pricing)).toBeNull();
    expect(activeForcedOpen({ ...pricing, forcedOpenUntil: pastIso })).toBeNull();
    expect(activeForcedOpen({ ...pricing, forcedOpenUntil: "not-a-date" })).toBeNull();
    expect(activeForcedOpen({ ...pricing, forcedOpenUntil: futureIso })).not.toBeNull();
  });

  it("forced open beats a closed schedule for pickup", () => {
    const closed = scheduleClosed();
    expect(isAcceptingOrders(closed).ok).toBe(false);
    expect(isAcceptingOrders({ ...closed, forcedOpenUntil: futureIso })).toEqual({ ok: true });
  });

  it("forced open never overrides a timed pause or the kill switch", () => {
    const closed = scheduleClosed();
    const paused = isAcceptingOrders({ ...closed, forcedOpenUntil: futureIso, pausedUntil: futureIso });
    expect(paused.ok).toBe(false);
    const killed = isAcceptingOrders({ ...closed, forcedOpenUntil: futureIso, acceptingOrders: false });
    expect(killed.ok).toBe(false);
  });

  it("forced open also opens delivery (one action opens both)", () => {
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" }).format(new Date());
    const todayIso = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekday] ?? 1;
    const otherDay = (todayIso % 7) + 1;
    const deliveryClosed = {
      ...pricing,
      deliveryOpenTime: "00:00",
      deliveryCloseTime: "23:59",
      deliveryDays: String(otherDay),
    };
    expect(isDeliveryAvailable(deliveryClosed).ok).toBe(false);
    expect(isDeliveryAvailable({ ...deliveryClosed, forcedOpenUntil: futureIso })).toEqual({ ok: true });
  });
});
