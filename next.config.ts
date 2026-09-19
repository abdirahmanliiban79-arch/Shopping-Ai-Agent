import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright", "mongoose"],
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;