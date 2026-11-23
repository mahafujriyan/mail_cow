import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:4100/api/:path*",
      },
    ];
  },
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'",
<<<<<<< HEAD
      // Next.js dev compiles with eval source maps. Production builds do not.
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
=======
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
>>>>>>> 5c00b5ac3a83bac3d4450112924e16bc7192fc80
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
