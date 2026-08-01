"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Check, CircleDot, Globe, Hash, Hexagon, Loader2, Lock, MapPin, Undo2, X } from "lucide-react";
import AdminManagementNav from "../AdminManagementNav";
import ManagementSkeleton from "../ui/ManagementSkeleton";
import type { PricingConfig as Pricing } from "@/lib/types";
import { DEFAULT_SERVICE_AREA, isValidPincode, type ServiceAreaConfig, type ServiceAreaMode } from "@/lib/service-area";

// Leaflet touches `window` at import time — client-only.
const ServiceAreaMap = dynamic(() => import("./ServiceAreaMap"), {
  ssr: false,
  loading: () => <div className="sa-map sa-map-loading">Loading map…</div>,
});

const modeCards: Array<{ mode: ServiceAreaMode; icon: typeof Globe; label: string; description: string }> = [
  { mode: "off", icon: Globe, label: "No restriction", description: "Deliver everywhere — no gating." },
  { mode: "pincode", icon: Hash, label: "By pincode", description: "Only listed pincodes." },
  { mode: "pincode_area", icon: MapPin, label: "By pincode + area", description: "Pincodes, narrowed to named localities." },
  { mode: "radius", icon: CircleDot, label: "By distance (radius)", description: "Within a set distance of the shop." },
  { mode: "polygon", icon: Hexagon, label: "By map boundary (polygon)", description: "Inside a custom map boundary." },
];

export default function ServiceAreaEditor() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [authExpired, setAuthExpired] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [saMode, setSaMode] = useState<ServiceAreaMode>(DEFAULT_SERVICE_AREA.mode);
  const [saPincodesText, setSaPincodesText] = useState("");
  const [saRadius, setSaRadius] = useState("");
  const [saShopLat, setSaShopLat] = useState("");
  const [saShopLng, setSaShopLng] = useState("");
  const [saPolygonText, setSaPolygonText] = useState("");

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function seedFromServiceArea(sa: ServiceAreaConfig) {
    setSaMode(sa.mode);
    setSaPincodesText(sa.pincodes.map((p) => (p.areas.length ? `${p.pincode}: ${p.areas.join(", ")}` : p.pincode)).join("\n"));
    setSaRadius(sa.radiusKm?.toString() ?? "");
    setSaShopLat(sa.shopLat?.toString() ?? "");
    setSaShopLng(sa.shopLng?.toString() ?? "");
    setSaPolygonText(sa.polygon.map(([a, b]) => `${a}, ${b}`).join("\n"));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/admin/pricing", { credentials: "include" });
        if (cancelled) return;
        if (response.status === 401) {
          setAuthExpired(true);
          return;
        }
        if (!response.ok) {
          setLoadError("Unable to load delivery area settings.");
          return;
        }
        const body: Pricing = await response.json();
        setPricing(body);
        seedFromServiceArea(body.serviceArea ?? DEFAULT_SERVICE_AREA);
      } catch {
        if (!cancelled) setLoadError("Unable to load delivery area settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function buildServiceArea(): { config: ServiceAreaConfig } | { error: string } {
    const pincodes: ServiceAreaConfig["pincodes"] = [];
    for (const line of saPincodesText.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) {
        // No areas on this line — allow several comma/space-separated pincodes at once.
        for (const token of line.split(/[\s,]+/).filter(Boolean)) {
          if (!isValidPincode(token)) return { error: `Invalid pincode: "${token}" — must be 6 digits` };
          pincodes.push({ pincode: token, areas: [] });
        }
        continue;
      }
      const pincode = line.slice(0, colonIndex).trim();
      if (!isValidPincode(pincode)) return { error: `Invalid pincode: "${pincode}" — must be 6 digits` };
      const areas = line.slice(colonIndex + 1).split(",").map((a) => a.trim()).filter(Boolean);
      pincodes.push({ pincode, areas });
    }
    const polygon: Array<[number, number]> = [];
    for (const line of saPolygonText.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const [latS, lngS] = line.split(",");
      const lat = Number(latS); const lng = Number(lngS);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: `Invalid polygon line: "${line}" — use "lat, lng"` };
      polygon.push([lat, lng]);
    }
    const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
    const radiusKm = numOrNull(saRadius); const shopLat = numOrNull(saShopLat); const shopLng = numOrNull(saShopLng);
    if ((radiusKm !== null && !(radiusKm > 0)) ||
        (shopLat !== null && !(shopLat >= -90 && shopLat <= 90)) ||
        (shopLng !== null && !(shopLng >= -180 && shopLng <= 180))) {
      return { error: "Invalid radius or shop coordinates" };
    }
    return { config: { mode: saMode, pincodes, radiusKm, shopLat, shopLng, polygon } };
  }

  function clearFeedback() {
    setSaved(false);
    setError("");
  }

  // Lenient numeric views of the text fields for the map preview — invalid or
  // partial input simply renders nothing rather than blocking the map.
  const looseNum = (s: string): number | null => {
    const t = s.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  const mapShopLat = looseNum(saShopLat);
  const mapShopLng = looseNum(saShopLng);
  const mapRadiusKm = looseNum(saRadius);
  const mapPolygon: Array<[number, number]> = saPolygonText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [latS, lngS] = line.split(",");
      return [Number(latS), Number(lngS)] as [number, number];
    })
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

  function handleMapPick(lat: number, lng: number) {
    clearFeedback();
    if (saMode === "radius") {
      setSaShopLat(String(lat));
      setSaShopLng(String(lng));
    } else if (saMode === "polygon") {
      setSaPolygonText((prev) => (prev.trim() ? `${prev.replace(/\n+$/, "")}\n${lat}, ${lng}` : `${lat}, ${lng}`));
    }
  }

  function handlePolygonUndo() {
    clearFeedback();
    setSaPolygonText((prev) => prev.split("\n").filter(Boolean).slice(0, -1).join("\n"));
  }

  function handlePolygonClear() {
    clearFeedback();
    setSaPolygonText("");
  }

  // Effective-state banner: reflects what would actually be saved right now,
  // so staff see whether an "active" mode is actually gating anything yet.
  function banner(): { tone: "info" | "success" | "warning"; text: string; summary?: string } {
    if (saMode === "off") {
      return { tone: "info", text: "Delivery is open everywhere." };
    }
    const built = buildServiceArea();
    if ("error" in built) {
      return {
        tone: "info",
        text: "Fix the highlighted input to see the effective delivery status.",
      };
    }
    const config = built.config;

    const unconfigured =
      !config ||
      ((saMode === "pincode" || saMode === "pincode_area") && config.pincodes.length === 0) ||
      (saMode === "radius" && (config.radiusKm == null || config.shopLat == null || config.shopLng == null)) ||
      (saMode === "polygon" && config.polygon.length < 3);

    if (unconfigured) {
      return {
        tone: "warning",
        text: "This mode is on but not configured yet — delivery is currently open everywhere.",
      };
    }

    let summary = "";
    if (saMode === "pincode" || saMode === "pincode_area") {
      summary = `${config.pincodes.length} pincode${config.pincodes.length === 1 ? "" : "s"} serviceable`;
    } else if (saMode === "radius") {
      summary = `Within ${config.radiusKm} km of shop`;
    } else if (saMode === "polygon") {
      summary = `Polygon with ${config.polygon.length} corners`;
    }
    return { tone: "success", text: "Delivery gating is active.", summary };
  }

  async function handleSave() {
    if (!pricing) return;
    const built = buildServiceArea();
    if ("error" in built) {
      setError(built.error);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/pricing", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...pricing, serviceArea: built.config }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save delivery area.");
      setPricing(body);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save delivery area.");
    } finally {
      setSaving(false);
    }
  }

  const currentBanner = pricing ? banner() : null;

  return (
    <AdminManagementNav
      title="Delivery area"
      subtitle="Control which addresses are eligible for home delivery."
    >
      <main className="management-page">
        {authExpired ? (
          <div className="management-locked">
            <Lock size={30} aria-hidden="true" />
            <h2>Admin session expired</h2>
            <p>Sign in again to manage the delivery area.</p>
            <Link href="/admin" className="management-primary-link">Go to admin login</Link>
          </div>
        ) : loading ? (
          <ManagementSkeleton rows={4} />
        ) : loadError ? (
          <div className="management-locked">
            <h2>Something went wrong</h2>
            <p>{loadError}</p>
          </div>
        ) : (
          <section className="management-workspace sa-editor">
            <div className="sa-mode-grid" role="radiogroup" aria-label="Delivery area mode">
              {modeCards.map(({ mode, icon: Icon, label, description }) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={saMode === mode}
                  className={`sa-mode-card${saMode === mode ? " active" : ""}`}
                  onClick={() => {
                    setSaMode(mode);
                    clearFeedback();
                  }}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span className="sa-mode-card-label">{label}</span>
                  <span className="sa-mode-card-description">{description}</span>
                </button>
              ))}
            </div>

            <div className="pricing-grid single">
              {(saMode === "pincode" || saMode === "pincode_area") && (
                <div className="pricing-field">
                  <label>Pincodes</label>
                  <textarea
                    value={saPincodesText}
                    onChange={(e) => {
                      setSaPincodesText(e.target.value);
                      clearFeedback();
                    }}
                  />
                  <span className="pricing-hint">
                    {saMode === "pincode_area"
                      ? "One per line: 713347: Sitarampur, Chelidanga (areas optional — bare pincode = whole pincode). Lines without areas may list several pincodes: 768019, 768018"
                      : "6-digit pincodes, separated by commas or new lines: 768019, 768018"}
                  </span>
                </div>
              )}

              {saMode === "radius" && (
                <>
                  <div className="pricing-field sa-map-field">
                    <label>Pick your shop on the map</label>
                    <ServiceAreaMap
                      mode="radius"
                      shopLat={mapShopLat}
                      shopLng={mapShopLng}
                      radiusKm={mapRadiusKm}
                      polygon={[]}
                      onPick={handleMapPick}
                    />
                    <span className="pricing-hint">Click the map to set the shop location — the circle previews your delivery radius.</span>
                  </div>
                  <div className="pricing-field">
                    <label>Radius (km)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={saRadius}
                      onChange={(e) => {
                        setSaRadius(e.target.value);
                        clearFeedback();
                      }}
                    />
                  </div>
                  <div className="pricing-field">
                    <label>Shop latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={saShopLat}
                      onChange={(e) => {
                        setSaShopLat(e.target.value);
                        clearFeedback();
                      }}
                    />
                  </div>
                  <div className="pricing-field">
                    <label>Shop longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={saShopLng}
                      onChange={(e) => {
                        setSaShopLng(e.target.value);
                        clearFeedback();
                      }}
                    />
                    <span className="pricing-hint">Get shop lat/lng from Google Maps (right-click your shop → copy coordinates)</span>
                  </div>
                </>
              )}

              {saMode === "polygon" && (
                <>
                  <div className="pricing-field sa-map-field">
                    <label>Draw your delivery boundary</label>
                    <ServiceAreaMap
                      mode="polygon"
                      shopLat={null}
                      shopLng={null}
                      radiusKm={null}
                      polygon={mapPolygon}
                      onPick={handleMapPick}
                    />
                    <div className="sa-map-actions">
                      <button type="button" className="btn-secondary" onClick={handlePolygonUndo} disabled={mapPolygon.length === 0}>
                        <Undo2 size={15} aria-hidden="true" /> Undo point
                      </button>
                      <button type="button" className="btn-secondary" onClick={handlePolygonClear} disabled={mapPolygon.length === 0}>
                        <X size={15} aria-hidden="true" /> Clear
                      </button>
                    </div>
                    <span className="pricing-hint">Click the map to add corners — at least 3 to close the boundary.</span>
                  </div>
                  <div className="pricing-field">
                    <label>Polygon corners</label>
                    <textarea
                      value={saPolygonText}
                      onChange={(e) => {
                        setSaPolygonText(e.target.value);
                        clearFeedback();
                      }}
                    />
                    <span className="pricing-hint">One corner per line as "lat, lng" — edited automatically when you click the map.</span>
                  </div>
                </>
              )}

              {saMode === "off" && (
                <p className="pricing-hint">No fields to configure — every delivery address is accepted.</p>
              )}
            </div>

            {currentBanner && (
              <div className={`sa-banner sa-banner-${currentBanner.tone}`} role="status">
                <p>{currentBanner.text}</p>
                {currentBanner.summary && <p className="sa-banner-summary">{currentBanner.summary}</p>}
              </div>
            )}

            {error && <p className="panel-error" role="alert">{error}</p>}

            <div className="panel-footer">
              <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check size={18} />
                    Saved!
                  </>
                ) : (
                  "Save Changes"
                )}
              </button>
            </div>
          </section>
        )}
      </main>
    </AdminManagementNav>
  );
}
