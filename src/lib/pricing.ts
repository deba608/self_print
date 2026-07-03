import type { PaperSize, PricingConfig, PrintDuplex, PrintType } from "./types";

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

export function selectedPageCount(pageCount: number, pageRange: string | null) {
  if (!pageRange?.trim()) return Math.max(pageCount, 1);
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

export function calculatePrice(input: {
  printType: PrintType;
  copies: number;
  pageRange: string | null;
  paperSize: PaperSize;
  pageCount: number;
  pricing: PricingConfig;
  duplex?: PrintDuplex;
}) {
  const selectedPages = selectedPageCount(input.pageCount, input.pageRange);
  const copies = Math.max(1, input.copies);
  if (input.paperSize === "Photo") {
    const duplexMultiplier = input.duplex === "simplex" ? 1.5 : 1;
    return Math.round(input.pricing.photoPrintPaise * copies * duplexMultiplier);
  }

  const isDuplex = input.duplex && input.duplex !== "simplex";
  const baseSimplex = input.printType === "bw" ? input.pricing.bwPerPagePaise : input.pricing.colorPerPagePaise;
  const baseDuplex = input.printType === "bw" ? input.pricing.duplexBwPerPagePaise : input.pricing.colorPerPagePaise;

  let pageCostSum = 0;
  if (!isDuplex) {
    pageCostSum = baseSimplex * selectedPages * 1.5;
  } else {
    const doubleSidedPages = Math.floor(selectedPages / 2) * 2;
    const singleSidedPages = selectedPages % 2;
    pageCostSum = (baseDuplex * doubleSidedPages * 1.0) + (baseSimplex * singleSidedPages * 1.5);
  }

  const multiplierKey = paperMultipliers[input.paperSize];
  const paperMultiplier = input.pricing[multiplierKey] as number;
  return Math.round(pageCostSum * copies * paperMultiplier * input.pricing.copyMultiplier);
}

export function formatRupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
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