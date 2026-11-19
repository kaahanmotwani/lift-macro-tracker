import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Meal photos and long natural-language imports both travel through server
    // actions; the 1 MB default is too small for a phone camera image.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
