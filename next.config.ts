import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow unoptimized local images while assets are being placed
    unoptimized: true,
  },
  typescript: {
    // We'll tighten this after assets are confirmed working
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
