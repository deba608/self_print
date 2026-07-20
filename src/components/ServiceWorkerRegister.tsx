"use client";

import { useEffect } from "react";

// Dev's hot-reload cycle fights with a service worker holding stale bundles,
// so this only registers in production builds.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline shell is a nice-to-have — a failed registration is silent */
    });
  }, []);

  return null;
}
