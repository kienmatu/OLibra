import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Traces the server build down to the files it actually uses, so the runtime
   * image carries no node_modules. Without this the image is roughly an order
   * of magnitude larger for no benefit — nothing in a container needs the
   * dependency tree once the build is done.
   */
  output: "standalone",
};

export default nextConfig;
