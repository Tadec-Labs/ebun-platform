import type { NextConfig } from "next";

/**
 * Baseline security headers for every page (the Brief's "secure headers"
 * control, matching the API's own set in apps/api/src/common).
 *
 * Referrer-Policy matters more here than usual: reveal links and the
 * vendor counter carry tokens in their URL paths, and the reveal page
 * links out to Google Maps. strict-origin-when-cross-origin sends other
 * sites only "https://<our domain>", never the path with the token in it.
 *
 * Permissions-Policy allows exactly what the product uses: the camera
 * (vendor counter QR scanning, video messages) and microphone (voice
 * messages), from our own pages only. Everything else is off.
 *
 * No Content-Security-Policy yet: Next's inline scripts need nonces to
 * work under a strict CSP, which is a change worth doing deliberately,
 * not as a side effect of a deploy patch.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
