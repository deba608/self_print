const PRIVATE_IP =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$)/;

export type GeoResult = { city: string | null; country: string | null };

export async function geoLookup(ip: string): Promise<GeoResult> {
  const empty: GeoResult = { city: null, country: null };
  if (!ip || ip === "unknown" || PRIVATE_IP.test(ip)) return empty;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(
      `https://ip-api.com/json/${ip}?fields=status,city,country`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return empty;
    const data: { status: string; city?: string; country?: string } =
      await res.json();
    if (data.status !== "success") return empty;
    return { city: data.city ?? null, country: data.country ?? null };
  } catch {
    return empty;
  }
}
