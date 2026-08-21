import { describe, it, expect } from "vitest";
import { calculatePrice, calculateSpiralBindingPrice, effectiveDeliveryFeePaise } from "./pricing";
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
