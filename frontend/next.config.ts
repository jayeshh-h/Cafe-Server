import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const upstream = (
      process.env.API_UPSTREAM_URL ||
      (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "")
    ).replace(/\/$/, "");
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: upstream ? [{ source: "/api/v1/:path*", destination: `${upstream}/api/v1/:path*` }] : [],
    };
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      {
        // Global OWASP Top 10 security headers
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Enforce zero stale caching on HTML pages & navigation across all browsers (Brave, Chrome, Safari)
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
};

export default nextConfig;
