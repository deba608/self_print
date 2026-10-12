import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep PDF parsers out of the bundled server chunk: @hyzyla/pdfium locates
  // its pdfium.wasm relative to its own package (bundling breaks that), and
  // pdfjs-dist is large enough to risk bundling skew with the client copy.
  // Without this, PDFium always fails in prod and every upload leans on the
  // pdf.js fallback — when that also stumbles, ALL PDFs 400.
  serverExternalPackages: ["@hyzyla/pdfium", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/jobs": ["./node_modules/@hyzyla/pdfium/pdfium.wasm"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb"
    }
  },
  async redirects() {
    return [
      // User login moved from /customer-login to /login.
      {
        source: "/customer-login",
        destination: "/login",
        permanent: true
      }
    ];
  }
};

export default nextConfig;
