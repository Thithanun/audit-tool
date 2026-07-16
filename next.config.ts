import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Docker / on-premise deployment (creates .next/standalone)
  output: "standalone",

  // Belt-and-suspenders no-cache headers (middleware.ts also sets these).
  // Scoped to exclude _next/static / _next/image so hashed immutable assets
  // keep their long-lived cache — only documents and data are forced fresh.
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },

  // Disable the client-side Router Cache for dynamic page segments so navigating
  // back to a page always re-renders. dynamic:0 is already the Next 16 default;
  // static must be >= 30 per Next's config validation, so it's set to the minimum.
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 30,
    },
  },
};

export default nextConfig;
