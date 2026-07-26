import type { NextConfig } from "next";

const isDesktopBuild = process.env.PI_WEB_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  // Desktop packaging gets an isolated standalone build. Keeping it outside
  // `.next` prevents a Tauri release build from disrupting `npm run dev`.
  // outputFileTracingRoot pins standalone file tracing to this package;
  // otherwise Windows builds can scan protected profile dirs (EPERM on
  // "C:\Users\<user>\Application Data") and fail.
  ...(isDesktopBuild
    ? { output: "standalone" as const, distDir: ".next-desktop", outputFileTracingRoot: __dirname }
    : {}),
  serverExternalPackages: [
    "undici",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ['192.168.*.*'],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
