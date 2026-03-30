import type { NextConfig } from "next";

const config: NextConfig = {
  // Bot runs as a separate process — only the web dashboard is served by Next.js
  serverExternalPackages: ["@slack/bolt", "@linear/sdk"],
};

export default config;
