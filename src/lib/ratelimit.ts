// Basic in-memory, per-instance rate limiter for serverless/API routes.
// Not distributed — each serverless instance has its own map — but enough to
// stop a single-source script from flooding public endpoints.

type Entry = { count: number; lastReset: number };

const buckets = new Map<string, Map<string, Entry>>();

export function isRateLimited(
  bucket: string,
  key: string,
  maxRequests: number,
  windowMs: number
): boolean {
  let map = buckets.get(bucket);
  if (!map) {
    map = new Map();
    buckets.set(bucket, map);
  }

  const now = Date.now();
  let entry = map.get(key);

  if (!entry || now - entry.lastReset > windowMs) {
    map.set(key, { count: 1, lastReset: now });

    // Periodically sweep old entries if the map gets too large
    if (map.size > 1000) {
      for (const [k, v] of map.entries()) {
        if (now - v.lastReset > windowMs) map.delete(k);
      }
    }
    return false;
  }

  entry.count++;
  return entry.count > maxRequests;
}

export function clientIp(headers: Headers): string {
  // Prefer the platform-injected header — set by the hosting proxy from the
  // real connection, so a client cannot spoof it. XFF entries are appended
  // left-to-right by proxies, meaning the LEFTMOST value is whatever the
  // client sent; trusting it lets one request rotate IPs and defeat every
  // limiter. The rightmost entry is the last trusted proxy hop instead.
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return "unknown";
}
