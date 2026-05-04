import type { NextConfig } from "next";

// Validates required env vars at startup. Throws on missing/malformed before any build runs.
import "./env";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
