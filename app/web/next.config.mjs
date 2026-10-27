import path from "node:path";
import { fileURLToPath } from "node:url";

// The browser only ever talks to this origin. In production the reverse proxy routes /api
// to the matching environment's API (v1/ops/Caddyfile.example), per hostname.
//
// Next.js bakes rewrites into the build (routes-manifest.json), so a rewrite target chosen
// at build time would be shared by every environment that runs this build (Client Ready and
// Demo). Production builds therefore have NO /api rewrite unless API_INTERNAL_URL is set at
// build time (single-environment setups only): a missing proxy route fails closed with a 404
// instead of reaching another environment's API (audit B03). Dev keeps the local default.
const isDev = process.env.NODE_ENV !== "production";
// Audit M6: the default applies to dev only, as described above (it used to apply to builds too).
const apiOrigin = process.env.API_INTERNAL_URL ?? (isDev ? "http://127.0.0.1:4000" : undefined);

// Security headers for HTML (audit B07). Next.js needs inline scripts (no nonce setup) and,
// in dev only, eval for React Refresh. Images may be same-origin uploads, data/blob URLs from
// the cropper, or external https URLs.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Ignored by browsers over plain http, so harmless locally; the proxy sets it too.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The local server (v2\local-server\) builds Client Ready and Demo separately, each with its
  // own API_INTERNAL_URL baked in, into .next-local-client / .next-local-demo. Default: .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Workspace root = v2\app (where package-lock.json is). Without this Next.js may pick a
  // stray lockfile higher up (e.g. in the user profile) as the root.
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  // Dev mode opened from another device (LAN IP, PC name or an internet tunnel): Next.js only
  // serves its dev assets / hot reload to these hosts. Set by local-server\START-NETWORK-DEV.ps1.
  ...(process.env.NEXT_ALLOWED_DEV_ORIGINS
    ? { allowedDevOrigins: process.env.NEXT_ALLOWED_DEV_ORIGINS.split(",").map((h) => h.trim()).filter(Boolean) }
    : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  // The shared package is TypeScript source, compiled by Next.
  transpilePackages: ["@rs-v31/shared"],
  async rewrites() {
    return apiOrigin ? [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }] : [];
  },
  async headers() {
    // /api responses get their own headers from the API (helmet); everything else gets these.
    return [{ source: "/((?!api/).*)", headers: securityHeaders }];
  },
};

export default nextConfig;
