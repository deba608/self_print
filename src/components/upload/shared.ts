import type { ServiceAreaConfig } from "@/lib/service-area";

// Client-side mirror of the server's MAX_UPLOAD_MB (src/lib/config.ts) so an
// oversized file is rejected the moment it's picked, not at submit time.
// Overridable via NEXT_PUBLIC_MAX_UPLOAD_MB — keep it in sync with the
// server's MAX_UPLOAD_MB (both default to 50).
const parsedMaxMb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 50);
export const MAX_UPLOAD_MB = Number.isFinite(parsedMaxMb) && parsedMaxMb > 0 ? parsedMaxMb : 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// Serverless platforms (Vercel) cap request bodies at ~4.5MB, so the inline
// fallback (file bytes sent inside the POST /api/jobs form when direct
// browser→storage upload is unavailable) can never exceed this off-localhost.
export const NON_LOCAL_FALLBACK_LIMIT_BYTES = 4 * 1024 * 1024;

// Hostnames where the inline fallback may use the full MAX_UPLOAD_BYTES —
// i.e. no platform body cap is in play. Loopback names plus the
// private-network IPs commonly used to reach a dev server from another
// device (e.g. a phone on 192.168.x.x); those hit the same local server,
// so the serverless cap doesn't apply to them either.
export function isLocalHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  const m172 = h.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

// Effective byte limit for one inline-fallback POST /api/jobs submission.
export function fallbackUploadLimit(hostname?: string): number {
  return hostname && isLocalHostname(hostname) ? MAX_UPLOAD_BYTES : NON_LOCAL_FALLBACK_LIMIT_BYTES;
}

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
  bondPaperPerPagePaise: number;
  spiralBindingSlab1Paise: number;
  spiralBindingSlab2Paise: number;
  spiralBindingSlab3Paise: number;
  spiralBindingSlab4Paise: number;
  spiralBindingSlab5Paise: number;
  expiryMinutes: number;
  deliveryFeePaise: number;
  freeDeliveryThresholdPaise: number;
  shopName?: string;
  shopReviewUrl?: string;
  razorpayKeyId?: string;
  serviceArea: ServiceAreaConfig;
  acceptingOrders: boolean;
  orderOpenTime: string | null;
  orderCloseTime: string | null;
  orderOpenTime2: string | null;
  orderCloseTime2: string | null;
  orderDays: string | null;
  deliveryOpenTime: string | null;
  deliveryCloseTime: string | null;
  deliveryDays: string | null;
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
