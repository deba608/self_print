import type { PaperSize, PricingConfig, PrintType } from "./types";

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
}) {
  const selectedPages = selectedPageCount(input.pageCount, input.pageRange);
  const copies = Math.max(1, input.copies);
  if (input.paperSize === "Photo") return input.pricing.photoPrintPaise * copies;
  const base = input.printType === "bw" ? input.pricing.bwPerPagePaise : input.pricing.colorPerPagePaise;
  const paperMultiplier = input.paperSize === "Legal" ? input.pricing.legalMultiplier : input.pricing.a4Multiplier;
  return Math.round(base * selectedPages * copies * paperMultiplier * input.pricing.copyMultiplier);
}

export function formatRupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}
