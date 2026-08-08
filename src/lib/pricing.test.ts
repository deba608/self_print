import { describe, it, expect } from "vitest";
import { calculatePrice } from "./pricing";
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
  spiralBindingPaise: 3000,
  coverFilePaise: 1000,
  expiryMinutes: 30,
  deliveryFeePaise: 0,
  serviceArea: DEFAULT_SERVICE_AREA,
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
