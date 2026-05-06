import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Ensure that we don't try to use server-side features
  trailingSlash: true,
};

export default nextConfig;
