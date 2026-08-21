import type { FileSettingsOverride, PaperSize, PricingConfig, PrintDuplex, PrintType } from "./types";

// Resolves one bulk file's effective print settings: its own override where
// present, falling back to the job-level value for every other field. The
// single place this merge happens — the server (pricing + the bulk insert)
// and the client estimate both call this instead of re-deriving it, so they
// can't drift apart.
export function effectiveFileSettings(
  jobDefaults: { printType: PrintType; duplex: PrintDuplex; paperSize: PaperSize; copies: number; pagesPerSheet: number },
  override: FileSettingsOverride | null | undefined
): { printType: PrintType; duplex: PrintDuplex; paperSize: PaperSize; copies: number; pagesPerSheet: number } {
  if (!override) return jobDefaults;
  return {
    printType: override.printType ?? jobDefaults.printType,
    duplex: override.duplex ?? jobDefaults.duplex,
    paperSize: override.paperSize ?? jobDefaults.paperSize,
    copies: override.copies ?? jobDefaults.copies,
    pagesPerSheet: override.pagesPerSheet ?? jobDefaults.pagesPerSheet,
  };
}

const paperMultipliers: Record<PaperSize, keyof Omit<PricingConfig, "bwPerPagePaise" | "colorPerPagePaise" | "photoPrintPaise" | "copyMultiplier" | "expiryMinutes">> = {
  A3: "a3Multiplier",
  A4: "a4Multiplier",
  A5: "a5Multiplier",
  A6: "a6Multiplier",
  B5: "b5Multiplier",
  Letter: "a4Multiplier",
  Legal: "legalMultiplier",
  Photo: "photoMultiplier"
};

export function selectedPageCount(pageCount?: number | null, pageRange?: string | null) {
  const total = Math.max(pageCount || 1, 1);
  if (!pageRange?.trim()) return total;
  // "even"/"odd" select half the document — must match the client estimate,
  // otherwise the final charge differs from the price shown to the customer.
  const normalized = pageRange.trim().toLowerCase();
  if (normalized === "even") return Math.max(Math.floor(total / 2), 1);
  if (normalized === "odd") return Math.ceil(total / 2);
  const pages = new Set<number>();
  for (const part of pageRange.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [startRaw, endRaw] = trimmed.split("-");
    const start = Number(startRaw);
    const end = Number(endRaw ?? startRaw);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) continue;
    for (let page = start; page <= Math.min(end, pageCount || end); page += 1) pages.add(page);
  }
  return Math.max(pages.size, 1);
}

export function calculateSpiralBindingPrice(selectedPages: number, pricing: PricingConfig) {
  if (selectedPages <= 70) return pricing.spiralBindingSlab1Paise;
  if (selectedPages <= 100) return pricing.spiralBindingSlab2Paise;
  if (selectedPages <= 150) return pricing.spiralBindingSlab3Paise;
  if (selectedPages <= 200) return pricing.spiralBindingSlab4Paise;
  return pricing.spiralBindingSlab5Paise;
}

export function calculatePrice(input: {
  printType: PrintType;
  copies: number;
  pageRange?: string | null;
  paperSize: PaperSize;
  duplex?: PrintDuplex | null;
  pageCount?: number | null;
  pagesPerSheet?: number | null;
  pricing: PricingConfig;
}) {
  const selectedPages = selectedPageCount(input.pageCount, input.pageRange);
  const copies = Math.max(1, input.copies);
  if (input.paperSize === "Photo") {
    return Math.round(input.pricing.photoPrintPaise * copies);
  }

  // N-up printing (pagesPerSheet > 1) crams multiple document pages onto one
  // printed side, so the shop only consumes ceil(pages / pagesPerSheet)
  // physical sides — that's what must be billed, not the raw page count.
  const pagesPerSheetVal = typeof input.pagesPerSheet === "number" && input.pagesPerSheet > 0 ? input.pagesPerSheet : 1;
  const sides = Math.ceil(selectedPages / Math.max(1, Math.floor(pagesPerSheetVal)));

  const isDuplex = input.duplex && input.duplex !== "simplex";
  const baseSimplex = input.printType === "bw" ? input.pricing.bwPerPagePaise : input.pricing.colorPerPagePaise;
  const baseDuplex = input.printType === "bw" ? input.pricing.duplexBwPerPagePaise : input.pricing.colorPerPagePaise;

  // Customers pay exactly the advertised per-side rate — no hidden multiplier.
  // Duplex full pairs (of sides) use the duplex rate; a trailing odd side
  // prints single-sided and costs the simplex rate.
  let pageCostSum = 0;
  if (!isDuplex) {
    pageCostSum = baseSimplex * sides;
  } else {
    const doubleSidedPages = Math.floor(sides / 2) * 2;
    const singleSidedPages = sides % 2;
    pageCostSum = (baseDuplex * doubleSidedPages) + (baseSimplex * singleSidedPages);
  }

  const multiplierKey = paperMultipliers[input.paperSize];
  const paperMultiplier = input.pricing[multiplierKey] as number;
  return Math.round(pageCostSum * copies * paperMultiplier * input.pricing.copyMultiplier);
}

// Delivery is free once the order (print + add-ons, before the delivery fee
// itself) crosses pricing.freeDeliveryThresholdPaise — admin-editable in the
// Pricing panel. A threshold of 0 disables the discount (fee always charged).
export function effectiveDeliveryFeePaise(orderSubtotalPaise: number, deliveryFeePaise: number, freeDeliveryThresholdPaise: number) {
  if (freeDeliveryThresholdPaise <= 0) return deliveryFeePaise;
  return orderSubtotalPaise >= freeDeliveryThresholdPaise ? 0 : deliveryFeePaise;
}

export function formatRupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

// Shop hours check — staff toggle in the Pricing panel. acceptingOrders is a
// manual kill switch; when both open/close times are set it's additionally
// gated to that daily window (shop-local, Asia/Kolkata — the deployment is
// India-only, see CLAUDE.md's bom1/ap-south-1 region note).
export function isAcceptingOrders(pricing: PricingConfig): { ok: true } | { ok: false; reason: string } {
  if (!pricing.acceptingOrders) {
    return { ok: false, reason: "We're not accepting new orders right now. Please check back later." };
  }
  if (pricing.orderOpenTime && pricing.orderCloseTime) {
    const nowHHMM = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
    const { orderOpenTime: open, orderCloseTime: close } = pricing;
    // Same-day window (e.g. 09:00-21:00) vs. overnight window (e.g. 21:00-06:00).
    const inWindow = open <= close ? nowHHMM >= open && nowHHMM < close : nowHHMM >= open || nowHHMM < close;
    if (!inWindow) {
      return { ok: false, reason: `We're currently closed. Orders are accepted ${open}–${close}.` };
    }
  }
  return { ok: true };
}

export const paperSizeLabels: Record<PaperSize, string> = {
  A3: "A3 (297 × 420 mm)",
  A4: "A4 (210 × 297 mm)",
  A5: "A5 (148 × 210 mm)",
  A6: "A6 (105 × 148 mm)",
  B5: "B5 (176 × 250 mm)",
  Letter: "Letter (8.5 × 11 in)",
  Legal: "Legal (8.5 × 14 in)",
  Photo: "Photo (4 × 6 in)"
};

export const allPaperSizes: PaperSize[] = ["A3", "A4", "A5", "A6", "B5", "Legal", "Letter", "Photo"];