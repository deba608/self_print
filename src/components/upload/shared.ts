import type { ServiceAreaConfig } from "@/lib/service-area";

// Client-side mirror of the server's MAX_UPLOAD_MB (src/lib/config.ts) so an
// oversized file is rejected the moment it's picked, not at submit time.
export const MAX_UPLOAD_MB = 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export function formatMb(bytes: number) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export type Pricing = {
  bwPerPagePaise: number;
  colorPerPagePaise: number;
  photoPrintPaise: number;
  copyMultiplier: number;
  a3Multiplier: number;
  a4Multiplier: number;
  a5Multiplier: number;
  a6Multiplier: number;
  b5Multiplier: number;
  legalMultiplier: number;
  photoMultiplier: number;
  duplexBwPerPagePaise: number;
  spiralBindingPerPagePaise: number;
  coverFilePaise: number;
  deliveryFeePaise: number;
  shopName?: string;
  shopReviewUrl?: string;
  razorpayKeyId?: string;
  serviceArea?: ServiceAreaConfig;
};

// Loads the Razorpay Standard Checkout script once and resolves when ready.
let razorpayScriptPromise: Promise<boolean> | null = null;
export function loadRazorpayCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if ((window as any).Razorpay) return Promise.resolve(true);
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => {
      razorpayScriptPromise = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

export function estimateRange(value: string) {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const [startRaw, endRaw] = part.trim().split("-");
    const start = Math.floor(Number(startRaw));
    const end = Math.floor(Number(endRaw ?? startRaw));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) continue;
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return Math.max(pages.size, 1);
}
