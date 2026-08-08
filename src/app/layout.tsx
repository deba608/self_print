import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AppChrome from "@/components/AppChrome";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["600"],
  variable: "--font-code",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Self_Print",
  description: "Self-service Xerox shop print queue",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Self_Print"
  }
};

export const viewport: Viewport = {
  themeColor: "#0d7a74",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <body>
        <AppChrome>{children}</AppChrome>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
