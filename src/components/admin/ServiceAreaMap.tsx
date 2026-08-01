"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, LayerGroup } from "leaflet";

// India-wide view when nothing is placed yet.
const FALLBACK_CENTER: [number, number] = [22.5, 82.5];
const FALLBACK_ZOOM = 5;

export type ServiceAreaMapProps = {
  mode: "radius" | "polygon";
  shopLat: number | null;
  shopLng: number | null;
  radiusKm: number | null;
  polygon: Array<[number, number]>;
  onPick: (lat: number, lng: number) => void;
};

// Plain-Leaflet wrapper (no react-leaflet): the library touches `window` at
// import time, so it is loaded inside useEffect and this component must only
// ever render client-side (parent imports it via next/dynamic ssr:false).
export default function ServiceAreaMap({ mode, shopLat, shopLng, radiusKm, polygon, onPick }: ServiceAreaMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LayerGroup | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView(FALLBACK_CENTER, FALLBACK_ZOOM);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      map.on("click", (event) => {
        const { lat, lng } = event.latlng;
        onPickRef.current(Number(lat.toFixed(6)), Number(lng.toFixed(6)));
      });
      layersRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const map = mapRef.current;
      const layers = layersRef.current;
      if (cancelled || !map || !layers) return;
      layers.clearLayers();

      if (mode === "radius") {
        if (shopLat !== null && shopLng !== null) {
          layers.addLayer(
            L.circleMarker([shopLat, shopLng], { radius: 7, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.9 })
          );
          if (radiusKm !== null && radiusKm > 0) {
            const circle = L.circle([shopLat, shopLng], {
              radius: radiusKm * 1000,
              color: "#2563eb",
              fillColor: "#3b82f6",
              fillOpacity: 0.12,
            });
            layers.addLayer(circle);
            map.fitBounds(circle.getBounds(), { padding: [24, 24] });
          } else if (map.getZoom() <= FALLBACK_ZOOM) {
            map.setView([shopLat, shopLng], 13);
          }
        }
      } else {
        for (const [lat, lng] of polygon) {
          layers.addLayer(
            L.circleMarker([lat, lng], { radius: 5, color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.9 })
          );
        }
        if (polygon.length >= 2) {
          const shape =
            polygon.length >= 3
              ? L.polygon(polygon, { color: "#2563eb", fillColor: "#3b82f6", fillOpacity: 0.12 })
              : L.polyline(polygon, { color: "#2563eb" });
          layers.addLayer(shape);
          if (map.getZoom() <= FALLBACK_ZOOM) {
            map.fitBounds(shape.getBounds(), { padding: [24, 24] });
          }
        } else if (polygon.length === 1 && map.getZoom() <= FALLBACK_ZOOM) {
          map.setView(polygon[0], 13);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, mode, shopLat, shopLng, radiusKm, polygon]);

  return <div ref={containerRef} className="sa-map" aria-label="Delivery area map" />;
}
