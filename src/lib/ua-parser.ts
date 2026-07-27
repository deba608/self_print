import type { ParsedUA } from "./types";

export function parseUA(ua: string | null): ParsedUA {
  if (!ua) return { browser: "Unknown", os: "Unknown", device: "Desktop" };

  // Device — check tablet before mobile (iPad UA contains "Mobile")
  const isTablet =
    /iPad/i.test(ua) ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const isMobile = !isTablet && /Mobi|Android|iPhone|iPod/i.test(ua);
  const device = isTablet ? "Tablet" : isMobile ? "Mobile" : "Desktop";

  // Browser — check Edge and Opera first; both embed "Chrome/" token
  let browser = "Unknown";
  const edgeMatch = ua.match(/Edg\/(\d+)/);
  const oprMatch = ua.match(/OPR\/(\d+)/);
  const chromeMatch = ua.match(/Chrome\/(\d+)/);
  const firefoxMatch = ua.match(/Firefox\/(\d+)/);
  const safariMatch = ua.match(/Version\/(\d+)[^)]*Safari/);
  if (edgeMatch) browser = `Edge ${edgeMatch[1]}`;
  else if (oprMatch) browser = `Opera ${oprMatch[1]}`;
  else if (chromeMatch) browser = `Chrome ${chromeMatch[1]}`;
  else if (firefoxMatch) browser = `Firefox ${firefoxMatch[1]}`;
  else if (safariMatch) browser = `Safari ${safariMatch[1]}`;

  // OS
  let os = "Unknown";
  const winMatch = ua.match(/Windows NT (\d+\.\d+)/);
  const macMatch = ua.match(/Mac OS X ([\d_]+)/);
  const androidMatch = ua.match(/Android (\d+)/);
  const iosMatch = ua.match(/(?:iPhone|iPad)(?: Simulator)? OS ([\d_]+)/i);

  if (winMatch) {
    const nt = winMatch[1];
    if (nt === "10.0") os = "Windows 10/11";
    else if (nt === "6.3") os = "Windows 8.1";
    else if (nt === "6.2") os = "Windows 8";
    else if (nt === "6.1") os = "Windows 7";
    else os = "Windows";
  } else if (androidMatch) {
    os = `Android ${androidMatch[1]}`;
  } else if (iosMatch) {
    os = `iOS ${iosMatch[1].replace(/_/g, ".")}`;
  } else if (macMatch) {
    os = `macOS ${macMatch[1].replace(/_/g, ".")}`;
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  return { browser, os, device };
}
