import type { NextConfig } from "next";

// Next.js configuration. Kept deliberately small for now — we add options here
// only when something actually needs them, so this file stays readable.
const nextConfig: NextConfig = {
  // Fail the production build on type errors instead of shipping broken code.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
