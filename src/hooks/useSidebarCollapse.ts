"use client";

import { useEffect, useState } from "react";

const KEY = "selfprint:admin:sidebar-collapsed";

// Desktop sidebar can be shrunk to icon-only width so it stays out of the
// way once staff know the nav by icon. Persisted so the choice sticks
// across page navigations (each admin page mounts this hook fresh).
export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(KEY) === "1");
    } catch { /* private mode */ }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* private mode */ }
      return next;
    });
  }

  return { collapsed, toggle };
}
