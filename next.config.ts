import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
