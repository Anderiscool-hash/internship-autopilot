import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// Next.js configuration. Kept deliberately small for now — we add options here
// only when something actually needs them, so this file stays readable.
const nextConfig = (phase: string): NextConfig => ({
  // Keep dev and production builds from removing each other's compiled pages.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  // Fail the production build on type errors instead of shipping broken code.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
});

export default nextConfig;
