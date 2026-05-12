import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Self_Print",
  description: "Self-service Xerox shop print queue"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
