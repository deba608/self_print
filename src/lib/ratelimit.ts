// Basic in-memory, per-instance rate limiter for serverless/API routes.
// Not distributed — each serverless instance has its own map — but enough to
// stop a single-source script from flooding public endpoints.

type Entry = { count: number; lastReset: number };

const buckets = new Map<string, Map<string, Entry>>();
console.log("DEBUG ratelimit module instance:", Math.random());

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
  // First hop of x-forwarded-for is the client as seen by the platform proxy.
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
