// Admin-selectable delivery gating. One active mode; every mode's data persists
// so switching modes never loses configuration. Unusable active-mode config
// fails OPEN — a half-filled dashboard form must not silently kill delivery.

export type ServiceAreaMode = "off" | "pincode" | "pincode_area" | "radius" | "polygon";
export type ServicePincode = { pincode: string; areas: string[] };
export type ServiceAreaConfig = {
  mode: ServiceAreaMode;
  pincodes: ServicePincode[];
  radiusKm: number | null;
  shopLat: number | null;
  shopLng: number | null;
  polygon: Array<[number, number]>;
};
export type ServiceCheckInput = {
  pincode: string | null;
  area: string | null;
  lat: number | null;
  lng: number | null;
};
export type ServiceCheckResult = { ok: true } | { ok: false; reason: string };

const MODES: ServiceAreaMode[] = ["off", "pincode", "pincode_area", "radius", "polygon"];
const PINCODE_RE = /^[1-9]\d{5}$/;
const MAX_AREA_LEN = 60;

export const REASON_PINCODE = "Delivery is not available for this pincode yet — please choose pickup";
export const REASON_AREA = "Delivery is not available in this area yet — please choose pickup";
export const REASON_LOCATION = "Your location is outside our delivery area — please choose pickup";
export const REASON_LOCATION_REQUIRED = "Location is required for home delivery — please share your location";

export const DEFAULT_SERVICE_AREA: ServiceAreaConfig = {
  mode: "off", pincodes: [], radiusKm: null, shopLat: null, shopLng: null, polygon: [],
};

export function isValidPincode(value: string): boolean {
  return PINCODE_RE.test(value);
}

function sanitize(value: unknown): ServiceAreaConfig {
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const mode = MODES.includes(obj.mode as ServiceAreaMode) ? (obj.mode as ServiceAreaMode) : "off";
  const pincodes: ServicePincode[] = [];
  if (Array.isArray(obj.pincodes)) {
    const seen = new Set<string>();
    for (const entry of obj.pincodes) {
      const pin = String((entry as any)?.pincode ?? "").trim();
      if (!isValidPincode(pin) || seen.has(pin)) continue;
      seen.add(pin);
      const areasRaw = Array.isArray((entry as any)?.areas) ? (entry as any).areas : [];
      const areas = [...new Set(
        areasRaw.map((a: unknown) => String(a).trim()).filter((a: string) => a.length > 0 && a.length <= MAX_AREA_LEN)
      )] as string[];
      pincodes.push({ pincode: pin, areas });
    }
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const radiusKm = num(obj.radiusKm);
  const shopLat = num(obj.shopLat);
  const shopLng = num(obj.shopLng);
  const polygon: Array<[number, number]> = [];
  if (Array.isArray(obj.polygon)) {
    for (const v of obj.polygon) {
      if (Array.isArray(v) && v.length === 2) {
        const lat = num(v[0]); const lng = num(v[1]);
        if (lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          polygon.push([lat, lng]);
        }
      }
    }
  }
  return {
    mode, pincodes,
    radiusKm: radiusKm !== null && radiusKm > 0 ? radiusKm : null,
    shopLat: shopLat !== null && shopLat >= -90 && shopLat <= 90 ? shopLat : null,
    shopLng: shopLng !== null && shopLng >= -180 && shopLng <= 180 ? shopLng : null,
    polygon,
  };
}

export function parseServiceAreaConfig(raw: string | null | undefined): ServiceAreaConfig {
  if (!raw) return { ...DEFAULT_SERVICE_AREA };
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SERVICE_AREA };
  }
}

export function serializeServiceAreaConfig(config: ServiceAreaConfig): string {
  return JSON.stringify(sanitize(config));
}

// Strict admin-input validation: unlike sanitize (which silently repairs stored
// data), this REJECTS so the dashboard surfaces mistakes instead of eating them.
export function validateServiceAreaConfig(value: unknown): { config: ServiceAreaConfig } | { error: string } {
  if (!value || typeof value !== "object") return { error: "Invalid service area config" };
  const obj = value as Record<string, unknown>;
  if (!MODES.includes(obj.mode as ServiceAreaMode)) return { error: "Invalid service area mode" };
  if (obj.pincodes !== undefined) {
    if (!Array.isArray(obj.pincodes)) return { error: "pincodes must be a list" };
    for (const entry of obj.pincodes) {
      const pin = String((entry as any)?.pincode ?? "");
      if (!isValidPincode(pin)) return { error: `Invalid pincode: ${pin}` };
      const areas = (entry as any)?.areas;
      if (areas !== undefined && !Array.isArray(areas)) return { error: `Areas for ${pin} must be a list` };
      for (const a of areas ?? []) {
        const name = String(a).trim();
        if (!name || name.length > MAX_AREA_LEN) return { error: `Invalid area name for ${pin}` };
      }
    }
  }
  if (obj.radiusKm !== undefined && obj.radiusKm !== null) {
    if (typeof obj.radiusKm !== "number" || !(obj.radiusKm > 0) || obj.radiusKm > 500) {
      return { error: "Radius must be between 0 and 500 km" };
    }
  }
  const coord = (v: unknown, min: number, max: number) =>
    v === undefined || v === null || (typeof v === "number" && v >= min && v <= max);
  if (!coord(obj.shopLat, -90, 90) || !coord(obj.shopLng, -180, 180)) {
    return { error: "Invalid shop coordinates" };
  }
  if (obj.polygon !== undefined) {
    if (!Array.isArray(obj.polygon)) return { error: "Polygon must be a list of [lat, lng] pairs" };
    for (const v of obj.polygon) {
      if (!Array.isArray(v) || v.length !== 2 || !coord(v[0], -90, 90) || !coord(v[1], -180, 180) ||
          v[0] === null || v[1] === null) {
        return { error: "Polygon must be a list of [lat, lng] pairs" };
      }
    }
  }
  return { config: sanitize(value) };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Ray casting: count edge crossings of a horizontal ray; odd = inside.
export function pointInPolygon(lat: number, lng: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    if ((lngI > lng) !== (lngJ > lng) &&
        lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI) {
      inside = !inside;
    }
  }
  return inside;
}

export function checkDeliveryServiceable(input: ServiceCheckInput, config: ServiceAreaConfig): ServiceCheckResult {
  switch (config.mode) {
    case "off":
      return { ok: true };
    case "pincode": {
      if (config.pincodes.length === 0) return { ok: true }; // fail open: mode on, list not filled yet
      if (!input.pincode || !config.pincodes.some((p) => p.pincode === input.pincode)) {
        return { ok: false, reason: REASON_PINCODE };
      }
      return { ok: true };
    }
    case "pincode_area": {
      if (config.pincodes.length === 0) return { ok: true };
      const entry = input.pincode ? config.pincodes.find((p) => p.pincode === input.pincode) : undefined;
      if (!entry) return { ok: false, reason: REASON_PINCODE };
      if (entry.areas.length === 0) return { ok: true }; // whole pincode serviceable
      const area = (input.area ?? "").trim().toLowerCase();
      if (!area || !entry.areas.some((a) => a.toLowerCase() === area)) {
        return { ok: false, reason: REASON_AREA };
      }
      return { ok: true };
    }
    case "radius": {
      if (config.radiusKm === null || config.shopLat === null || config.shopLng === null) return { ok: true };
      if (input.lat === null || input.lng === null) return { ok: false, reason: REASON_LOCATION_REQUIRED };
      return haversineKm(config.shopLat, config.shopLng, input.lat, input.lng) <= config.radiusKm
        ? { ok: true }
        : { ok: false, reason: REASON_LOCATION };
    }
    case "polygon": {
      if (config.polygon.length < 3) return { ok: true };
      if (input.lat === null || input.lng === null) return { ok: false, reason: REASON_LOCATION_REQUIRED };
      return pointInPolygon(input.lat, input.lng, config.polygon)
        ? { ok: true }
        : { ok: false, reason: REASON_LOCATION };
    }
  }
}
